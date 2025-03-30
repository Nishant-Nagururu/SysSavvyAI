import os
import subprocess
import tarfile
import tempfile
import requests
from flask import Flask, after_this_request, request, jsonify, send_file
import json
from openai import OpenAI
import time
from mongoengine import connect
from schemas.runModel import Run, TerraformFile
from schemas.moduleModel import Module, ModuleChunk
import re
from dotenv import load_dotenv
import base64
from openai import OpenAI
from flask_cors import CORS
from mongoengine.errors import DoesNotExist
from urllib.parse import quote

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

app = Flask(__name__)

CORS(app, resources={r"/*": {"origins": "http://localhost:3000"}})

# Read environment variables
MONGODB_URI = os.getenv("MONGODB_URI")
HCPT_TOKEN = os.getenv("HCPT_TOKEN")
HCPT_ORG = os.getenv("HCPT_ORG")        
HCPT_WORKSPACE = os.getenv("HCPT_WORKSPACE")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
ASSISTANT_ID = os.getenv("ASSISTANT_ID")
VECTOR_STORE_ID = os.getenv("VECTOR_STORE_ID")

GITHUB_ORG = "terraform-aws-modules"
GITHUB_API_URL = "https://api.github.com"
GITHUB_HEADERS = {}
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
if GITHUB_TOKEN:
    GITHUB_HEADERS["Authorization"] = f"token {GITHUB_TOKEN}"

# Base URL for Terraform Cloud / HCP Terraform API
BASE_URL = "https://app.terraform.io/api/v2"
API_CONTENT_TYPE = "application/vnd.api+json"

MISSING_HCPT_TOKEN_RESPONSE = {"error": "Missing HCPT_TOKEN environment variable."}
MISSING_RUN_ID_RESPONSE = {"error": "Missing 'run_id' in JSON payload."}

def get_workspace_id():
    """
    Retrieve the workspace ID given HCPT_ORG and HCPT_WORKSPACE.
    """
    url = f"{BASE_URL}/organizations/{HCPT_ORG}/workspaces/{HCPT_WORKSPACE}"
    headers = {
        "Authorization": f"Bearer {HCPT_TOKEN}",
        "Content-Type": API_CONTENT_TYPE,
    }
    resp = requests.get(url, headers=headers)
    if resp.status_code != 200:
        raise Exception(f"Failed to look up workspace: {resp.text}")
    return resp.json()["data"]["id"]


def clean_up_temp_dir(path):
    """Remove the temporary directory and all its files."""
    try:
        for root, dirs, files in os.walk(path, topdown=False):
            for name in files:
                os.remove(os.path.join(root, name))
            for name in dirs:
                os.rmdir(os.path.join(root, name))
        os.rmdir(path)
    except Exception:
        pass  # best-effort cleanup

def get_readme_embedding(readme_text):
    response = client.embeddings.create(input=readme_text,
    model="text-embedding-ada-002")
    # The embedding is usually found in the first element of the data list.
    embedding = response.data[0].embedding
    return embedding

def upload_to_vector_store(file_path):
    """
    Placeholder function for uploading a file to your vector store via the OpenAI client.
    Replace the content of this function with your actual upload logic.
    """
    try:
        # Example: using a hypothetical method on openai_client.
        response = client.files.create(file=open(file_path, "rb"),
                                       purpose="assistants")
        file_id = response.id
        print("FILE ID:", file_id)
        return file_id
    except Exception as e:
        print(f"Error uploading file {file_path}: {e}")
        return None

def get_repos(org):
    url = f"{GITHUB_API_URL}/orgs/{org}/repos?per_page=100"
    response = requests.get(url, headers=GITHUB_HEADERS)
    if response.status_code != 200:
        return []
    return response.json()

def get_contents(repo, path):
    url = f"{GITHUB_API_URL}/repos/{GITHUB_ORG}/{repo}/contents/{path}"
    response = requests.get(url, headers=GITHUB_HEADERS)
    if response.status_code == 200:
        return response.json()
    return None

def decode_file_content(file_data, repo, folder_path, target_file):
    """Helper to decode file content from a file response."""
    if file_data.get("encoding") == "base64" and "content" in file_data:
        try:
            return base64.b64decode(file_data["content"]).decode("utf-8")
        except Exception as e:
            print(f"Error decoding content for {repo} - {folder_path}/{target_file}: {e}")
            return None
    return file_data.get("content")

def get_file_from_folder(repo, folder_path, target_file):
    """
    Fetches the content of target_file (e.g. main.tf) from a given folder in a repo.
    Returns a tuple (content, html_url) if found; otherwise, (None, None).
    """
    contents = get_contents(repo, folder_path)
    if not contents:
        return None, None

    target_file_lower = target_file.lower()
    for item in contents:
        if item.get("type") != "file" or item.get("name", "").lower() != target_file_lower:
            continue

        file_response = requests.get(item["url"], headers=GITHUB_HEADERS)
        if file_response.status_code != 200:
            continue

        file_data = file_response.json()
        content_decoded = decode_file_content(file_data, repo, folder_path, target_file)
        return content_decoded, item.get("html_url")

    return None, None

@app.route("/store-readmes", methods=["POST"])
def store_examples():
    """
    Fetches repositories from the 'terraform-aws-modules' GitHub organization,
    iterates over each repo to look for a top-level 'examples' folder, then for each
    example folder verifies that it contains main.tf, variables.tf, outputs.tf, and versions.tf.
    Optionally, a README.md may be present. The files are combined into a single text file
    (with README at the top if available, then variables.tf, versions.tf, main.tf, outputs.tf),
    saved locally, and then uploaded to a vector store via the OpenAI client.
    """

    repos = get_repos(GITHUB_ORG)
    if not repos:
        return jsonify({"error": "No repositories found in organization."}), 404

    # Ensure that the directory for storing text files exists.
    output_dir = "examples_combined"
    os.makedirs(output_dir, exist_ok=True)

    total_examples = 0
    file_ids = []

    # Required files (README is optional)
    required_files = ["main.tf", "variables.tf", "outputs.tf", "versions.tf"]
    optional_file = "README.md"

    for repo in repos:
        repo_name = repo["name"]
        examples = get_contents(repo_name, "examples")
        if not examples:
            continue
        for example in examples:
            if example["type"] != "dir":
                continue
            example_name = example["name"]
            folder_path = f"examples/{example_name}"

            # Check that all required files exist.
            file_contents = {}
            skip_example = False
            for file in required_files:
                content, _ = get_file_from_folder(repo_name, folder_path, file)
                if content is None:
                    print(f"Skipping {repo_name}/{example_name}: missing required file {file}")
                    skip_example = True
                    break
                file_contents[file] = content
            if skip_example:
                continue

            # Attempt to get the optional README.
            readme_content, _ = get_file_from_folder(repo_name, folder_path, optional_file)
            
            # Build header for the combined file.
            header = f"# Repo: {repo_name}, Example: {example_name}"
            
            # Combine the file contents.
            # Order: README (if exists), variables.tf, versions.tf, main.tf, outputs.tf.
            combined = header + "\n\n"
            if readme_content:
                combined += readme_content + "\n\n"
            combined += "### variables.tf\n\n" + file_contents["variables.tf"] + "\n\n"
            combined += "### versions.tf\n\n" + file_contents["versions.tf"] + "\n\n"
            combined += "### main.tf\n\n" + file_contents["main.tf"] + "\n\n"
            combined += "### outputs.tf\n\n" + file_contents["outputs.tf"]

            # Define a file path to save the combined content.
            safe_repo = repo_name.replace(" ", "_")
            safe_example = example_name.replace(" ", "_")
            file_name = f"{safe_repo}_{safe_example}_combined.txt"
            file_path = os.path.join(output_dir, file_name)

            try:
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(combined)
                print(f"Saved combined file for {repo_name}/{example_name} to {file_path}")
            except Exception as e:
                print(f"Error writing file {file_path}: {e}")
                continue

            # Prepare metadata (extend this with more details as needed).
            metadata = {
                "repo": repo_name,
                "example": example_name,
                "folder_path": folder_path,
            }

            # Upload the file to the vector store.
            file_id = upload_to_vector_store(file_path)
            if file_id:
                file_ids.append(file_id)

            total_examples += 1

    # Upload files in batches to the vector store.
    chunk_size = 10
    batch_results = []
    for i in range(0, len(file_ids), chunk_size):
        chunk = file_ids[i:min(i + chunk_size, len(file_ids))]
        batch_add = client.beta.vector_stores.file_batches.create(
            vector_store_id=VECTOR_STORE_ID,
            file_ids=chunk
        )
        # Optionally, wait briefly before processing the next chunk.
        time.sleep(1)
        print("Batch status for chunk starting at index", i, ":", batch_add.status)
        batch_results.append({"file_ids": chunk, "batch_status": batch_add.status})
    
    return jsonify({"message": f"Processed and uploaded combined files for {total_examples} example(s) from GitHub.", "batches": batch_results}), 200

@app.route("/upload-terraform", methods=["POST"])
def upload_terraform():
    """
    Accepts uploaded Terraform .tf files, packages them into a tar.gz,
    triggers an HCP Terraform run via the API, and stores the run details
    including the .tf files and their contents in MongoDB.
    """
    if not HCPT_TOKEN or not HCPT_ORG or not HCPT_WORKSPACE:
        return jsonify({"error": "Server missing required environment variables."}), 500

    # Collect uploaded .tf files (multiple files allowed)
    uploaded_files = request.files.getlist("tf_files")
    if not uploaded_files:
        return jsonify({"error": "No files received."}), 400

    # Create a temporary directory for the uploaded files
    temp_dir = tempfile.mkdtemp()
    file_paths = []
    tf_files_data = []  # To hold file names and contents for MongoDB

    for f in uploaded_files:
        filename = f.filename
        if not filename.endswith(".tf"):
            clean_up_temp_dir(temp_dir)
            return jsonify({"error": f"File {filename} is not a .tf file."}), 400

        # Save file to temporary directory
        save_path = os.path.join(temp_dir, filename)
        f.save(save_path)
        file_paths.append(save_path)

        # Read file content for MongoDB
        with open(save_path, "r") as file:
            content = file.read()
            tf_files_data.append(TerraformFile(file_name=filename, file_content=content))

    # Run Terraform linting before packaging
    # Initialize Terraform
    init_result = subprocess.run(["terraform", "init", "-input=false"], cwd=temp_dir, capture_output=True, text=True)
    if init_result.returncode != 0:
        clean_up_temp_dir(temp_dir)
        return jsonify({"error": "Terraform init failed", "details": init_result.stderr}), 400

    # Run Terraform validate
    validate_result = subprocess.run(["terraform", "validate"], cwd=temp_dir, capture_output=True, text=True)
    if validate_result.returncode != 0:
        clean_up_temp_dir(temp_dir)
        return jsonify({"error": "Terraform validate failed", "details": validate_result.stderr}), 400

    # Run TFLint in JSON format
    tflint_result = subprocess.run(["tflint", "-f", "json"], cwd=temp_dir, capture_output=True, text=True)
    try:
        lint_output = json.loads(tflint_result.stdout)
        if lint_output.get("issues"):
            clean_up_temp_dir(temp_dir)
            return jsonify({"error": "TFLint found issues", "details": lint_output["issues"]}), 400
    except json.JSONDecodeError as e:
        # If TFLint output cannot be parsed as JSON, consider it a failure.
        clean_up_temp_dir(temp_dir)
        return jsonify({"error": "Failed to parse TFLint output", "details": str(e)}), 400

    # Create a tar.gz archive from the .tf files
    tar_path = os.path.join(temp_dir, "content.tar.gz")
    with tarfile.open(tar_path, "w:gz") as tar:
        for path in file_paths:
            arcname = os.path.basename(path)
            tar.add(path, arcname=arcname)

    # Get workspace ID
    try:
        workspace_id = get_workspace_id()
    except Exception as e:
        clean_up_temp_dir(temp_dir)
        return jsonify({"error": str(e)}), 400

    # Create a new configuration version
    create_cv_url = f"{BASE_URL}/workspaces/{workspace_id}/configuration-versions"
    headers = {
        "Authorization": f"Bearer {HCPT_TOKEN}",
        "Content-Type": API_CONTENT_TYPE,
    }
    payload = {
        "data": {
            "type": "configuration-versions"
        }
    }
    resp = requests.post(create_cv_url, headers=headers, json=payload)
    if resp.status_code != 201:
        clean_up_temp_dir(temp_dir)
        return jsonify({"error": "Failed to create configuration version.", "details": resp.text}), 400

    upload_url = resp.json()["data"]["attributes"]["upload-url"]

    # Upload the tar.gz file to the signed upload URL
    with open(tar_path, "rb") as f:
        put_headers = {
            "Content-Type": "application/octet-stream"
        }
        put_resp = requests.put(upload_url, data=f, headers=put_headers)

    if put_resp.status_code not in (200, 201):
        clean_up_temp_dir(temp_dir)
        return jsonify({"error": "Failed to upload configuration file.", "details": put_resp.text}), 400

    # Wait briefly to ensure the run is triggered
    time.sleep(2)

    # Fetch the most recent run for the workspace
    runs_url = f"{BASE_URL}/workspaces/{workspace_id}/runs"
    runs_resp = requests.get(runs_url, headers=headers)

    if runs_resp.status_code != 200:
        clean_up_temp_dir(temp_dir)
        return jsonify({"error": "Failed to fetch runs.", "details": runs_resp.text}), 400

    runs_data = runs_resp.json()
    if not runs_data["data"]:
        clean_up_temp_dir(temp_dir)
        return jsonify({"error": "No runs found after configuration upload."}), 400

    # Get the most recent run ID
    latest_run = runs_data["data"][0]
    run_id = latest_run["id"]

    # Save run details and .tf files to MongoDB
    try:
        run_doc = Run(
            run_id=run_id,
            tf_files=tf_files_data,
            workspace_id=workspace_id,
            organization_name=HCPT_ORG
        )
        run_doc.save()
    except Exception as e:
        clean_up_temp_dir(temp_dir)
        return jsonify({"error": "Failed to save run details to MongoDB.", "details": str(e)}), 500

    # Clean up temporary files
    clean_up_temp_dir(temp_dir)

    # Return success message with run_id
    return jsonify({
        "message": "Terraform configuration uploaded successfully. Run triggered and stored in MongoDB.",
        "run_id": run_id
    }), 200

@app.route("/runs", methods=["GET"])
def get_runs():
    """
    Retrieve recent runs for the configured workspace.
    """
    if not HCPT_TOKEN or not HCPT_ORG or not HCPT_WORKSPACE:
        return jsonify({"error": "Server missing required environment variables."}), 500

    try:
        workspace_id = get_workspace_id()
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    runs_url = f"{BASE_URL}/workspaces/{workspace_id}/runs"
    headers = {
        "Authorization": f"Bearer {HCPT_TOKEN}",
        "Content-Type": API_CONTENT_TYPE,
    }
    resp = requests.get(runs_url, headers=headers)
    if resp.status_code != 200:
        return jsonify({"error": "Failed to fetch runs.", "details": resp.text}), 400

    return jsonify(resp.json()), 200


@app.route("/approve-run", methods=["POST"])
def approve_run():
    """
    Approve (apply) a run that is waiting for approval.
    Expects JSON payload with a 'run_id' and an optional 'comment'.
    """
    if not HCPT_TOKEN:
        return jsonify(MISSING_HCPT_TOKEN_RESPONSE), 500

    data = request.get_json()
    if not data or "run_id" not in data:
        return jsonify(MISSING_RUN_ID_RESPONSE), 400

    run_id = data["run_id"]
    comment = data.get("comment", "Approved via API")

    encoded_run_id = quote(run_id, safe='')
    approve_url = f"{BASE_URL}/runs/{encoded_run_id}/actions/apply"
    headers = {
        "Authorization": f"Bearer {HCPT_TOKEN}",
        "Content-Type": API_CONTENT_TYPE,
    }
    payload = {"comment": comment}

    resp = requests.post(approve_url, headers=headers, json=payload)
    if resp.status_code != 200:
        return jsonify({"error": "Failed to approve run.", "details": resp.text}), 400

    return jsonify({"message": f"Run {run_id} approved successfully.", "run": resp.json()}), 200


@app.route("/cancel-run", methods=["POST"])
def cancel_run():
    """
    Cancel a run by specifying the run_id and an optional comment.
    Expects JSON payload with a 'run_id' and optionally 'comment'.
    """
    if not HCPT_TOKEN:
        return jsonify(MISSING_HCPT_TOKEN_RESPONSE), 500

    data = request.get_json()
    if not data or "run_id" not in data:
        return jsonify(MISSING_RUN_ID_RESPONSE), 400

    run_id = data["run_id"]
    comment = data.get("comment", "Canceled via API")

    encoded_run_id = quote(run_id, safe='')
    cancel_url = f"{BASE_URL}/runs/{encoded_run_id}/actions/cancel"
    headers = {
        "Authorization": f"Bearer {HCPT_TOKEN}",
        "Content-Type": API_CONTENT_TYPE,
    }
    payload = {"comment": comment}

    resp = requests.post(cancel_url, headers=headers, json=payload)
    if resp.status_code != 200:
        return jsonify({"error": "Failed to cancel run.", "details": resp.text}), 400

    return jsonify({"message": f"Run {run_id} canceled successfully.", "run": resp.json()}), 200


@app.route("/discard-run", methods=["POST"])
def discard_run():
    """
    Discard a run that is waiting for confirmation (i.e. not approving it).
    This is different from canceling. Expects JSON payload with a 'run_id'
    and optionally a 'comment'.
    """
    if not HCPT_TOKEN:
        return jsonify(MISSING_HCPT_TOKEN_RESPONSE), 500

    data = request.get_json()

    print("DATA:", data)
    if not data or "run_id" not in data:
        return jsonify(MISSING_RUN_ID_RESPONSE), 400

    run_id = data["run_id"]
    comment = data.get("comment", "Discarded via API")

    encoded_run_id = quote(run_id, safe='')
    discard_url = f"{BASE_URL}/runs/{encoded_run_id}/actions/discard"
    headers = {
        "Authorization": f"Bearer {HCPT_TOKEN}",
        "Content-Type": API_CONTENT_TYPE,
    }
    payload = {"comment": comment}

    resp = requests.post(discard_url, headers=headers, json=payload)
    if resp.status_code != 200:
        return jsonify({"error": "Failed to discard run.", "details": resp.text}), 400

    return jsonify({"message": f"Run {run_id} discarded successfully.", "run": resp.json()}), 200


def fetch_log_from_attributes(endpoint_url):
    """
    Helper function that calls a given endpoint (apply or plan), extracts the log-read-url,
    fetches the log content, and returns the text.
    """
    headers = {
        "Authorization": f"Bearer {HCPT_TOKEN}",
        "Content-Type": API_CONTENT_TYPE,
    }
    resp = requests.get(endpoint_url, headers=headers)
    if resp.status_code != 200:
        return None, f"Failed to fetch data from {endpoint_url}: {resp.text}"
    try:
        data = resp.json().get("data", {})
        attributes = data.get("attributes", {})
        log_url = attributes.get("log-read-url")
        if not log_url:
            return None, "log-read-url not found in response attributes."
        # Now fetch the log content from the log-read-url
        log_resp = requests.get(log_url)
        if log_resp.status_code != 200:
            return None, f"Failed to fetch log content: {log_resp.text}"
        return log_resp.text, None
    except Exception as e:
        return None, str(e)


@app.route("/apply-log/<run_id>", methods=["GET"])
def get_apply_log(run_id):
    """
    Retrieve the apply log for a run.
    Calls the endpoint: GET https://app.terraform.io/api/v2/runs/{run_id}/apply,
    then fetches the log from the log-read-url in the returned attributes.
    """
    encoded_run_id = quote(run_id, safe='')
    endpoint_url = f"{BASE_URL}/runs/{encoded_run_id}/apply"
    log_text, error = fetch_log_from_attributes(endpoint_url)
    if error:
        return jsonify({"error": "Failed to fetch apply log.", "details": error}), 400
    return log_text, 200


@app.route("/plan-log/<run_id>", methods=["GET"])
def get_plan_log(run_id):
    """
    Retrieve the plan log for a run.
    Calls the endpoint: GET https://app.terraform.io/api/v2/runs/{run_id}/plan,
    then fetches the log from the log-read-url in the returned attributes.
    """
    encoded_run_id = quote(run_id, safe='')
    endpoint_url = f"{BASE_URL}/runs/{encoded_run_id}/plan"
    log_text, error = fetch_log_from_attributes(endpoint_url)
    if error:
        return jsonify({"error": "Failed to fetch plan log.", "details": error}), 400
    return log_text, 200

@app.route("/get-tf/<run_id>", methods=["GET"])
def get_tf(run_id):
    try:
        run_doc = Run.objects.get(run_id=run_id)
    except DoesNotExist:
        return jsonify({"error": f"No run found with run_id: {run_id}"}), 404
    except Exception as e:
        return jsonify({"error": "Database error", "details": str(e)}), 500

    if not run_doc.tf_files:
        return jsonify({"error": "No .tf files associated with this run."}), 400

    # Convert EmbeddedDocuments into plain dicts
    tf_files = [
        {"file_name": tf.file_name, "file_content": tf.file_content}
        for tf in run_doc.tf_files
    ]

    return jsonify({"tf_files": tf_files}), 200


@app.route("/destroy-run", methods=["POST"])
def destroy_run():
    """
    Trigger a Terraform destroy run.
    This route creates a new run with the 'is-destroy' flag set to true.
    Expects an optional JSON payload with a 'message' attribute.
    """
    if not HCPT_TOKEN:
        return jsonify(MISSING_HCPT_TOKEN_RESPONSE), 500

    data = request.get_json() or {}
    message = data.get("message", "Destroy triggered via API")

    try:
        workspace_id = get_workspace_id()
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    payload = {
        "data": {
            "attributes": {
                "is-destroy": True,
                "message": message
            },
            "type": "runs",
            "relationships": {
                "workspace": {
                    "data": {
                        "id": workspace_id,
                        "type": "workspaces"
                    }
                }
            }
        }
    }

    url = f"{BASE_URL}/runs"
    headers = {
        "Authorization": f"Bearer {HCPT_TOKEN}",
        "Content-Type": API_CONTENT_TYPE
    }

    resp = requests.post(url, headers=headers, json=payload)
    if resp.status_code != 201:
        return jsonify({"error": "Failed to trigger destroy run.", "details": resp.text}), 400

    return jsonify({"message": "Destroy run triggered successfully.", "run": resp.text}), 200

# ----------------------------------------------------------
# New Route: Generate Terraform Code from a Prompt Using OpenAI
# ----------------------------------------------------------
@app.route("/generate-tf", methods=["POST"])
def generate_tf():
    """
    Takes a JSON payload with a "message" field (a prompt describing an AWS architecture),
    sends it to the OpenAI Chat Completion API (using the assistant with id ASSISTANT_ID)
    which is configured to return only Terraform (.tf) code.
    Saves the returned code in a uniquely named .tf file and returns the file as a download.
    """
    data = request.get_json()
    if not data or "message" not in data:
        return jsonify({"error": "Missing 'message' in JSON payload."}), 400

    prompt = data["message"]

    # Send prompt to the API and retrieve response (example code)
    thread = client.beta.threads.create(messages=[{"role": "user", "content": prompt}])
    run = client.beta.threads.runs.create(thread_id=thread.id, assistant_id=ASSISTANT_ID)

    while run.status != "completed":
        time.sleep(1)
        run = client.beta.threads.runs.retrieve(thread_id=thread.id, run_id=run.id)

    message_response = client.beta.threads.messages.list(thread_id=thread.id)

    # Retrieve the assistant message
    latest_message = message_response.data[0]
    for msg in message_response.data:
        if msg.role == "assistant":
            latest_message = msg

    try:
        code = latest_message.content[0].text.value
    except (IndexError, AttributeError):
        code = latest_message.content[0].text if latest_message.content else ""

    filename = f"generated_{int(time.time())}.tf"
    try:
        with open(filename, "w") as f:
            f.write(code)
    except Exception as e:
        return jsonify({"error": "Failed to write code to file", "details": str(e)}), 500

    # Schedule file deletion after sending the response
    @after_this_request
    def remove_file(response):
        try:
            os.remove(filename)
        except Exception as e:
            app.logger.error("Error removing file: %s", e)
        return response

    # Return the file as a download
    return send_file(filename, as_attachment=True, download_name=filename)


@app.route('/get_cost_estimate/<run_id>', methods=['GET'])
def get_cost_estimate(run_id):
    try:
        # First API call to get run details
        encoded_run_id = quote(run_id, safe='')
        run_url = f'https://app.terraform.io/api/v2/runs/{encoded_run_id}'
        headers = {
            "Authorization": f"Bearer {HCPT_TOKEN}",
            "Content-Type": API_CONTENT_TYPE,
        }
        run_response = requests.get(run_url, headers=headers)
        run_response.raise_for_status()

        run_data = run_response.json()

        # Extract the cost estimate URL
        cost_estimate_path = run_data['data']['relationships']['cost-estimate']['links']['related']
        cost_estimate_url = f'https://app.terraform.io{cost_estimate_path}'

        # Second API call to get cost estimate details
        cost_response = requests.get(cost_estimate_url, headers=headers)
        cost_response.raise_for_status()

        cost_data = cost_response.json()

        # Extract relevant cost estimate details
        matched_resources = cost_data['data']['attributes']['resources']['matched']
        result = []

        for resource in matched_resources:
            resource_details = {
                'name': resource.get('name'),
                'type': resource.get('type'),
                'hourly-cost': resource.get('hourly-cost'),
                'prior-monthly-cost': resource.get('prior-monthly-cost'),
                'proposed-monthly-cost': resource.get('proposed-monthly-cost'),
                'delta-monthly-cost': resource.get('delta-monthly-cost')
            }
            result.append(resource_details)

        return jsonify(result), 200

    except requests.exceptions.HTTPError as http_err:
        return jsonify({'error': f'HTTP error occurred: {http_err}'}), 500
    except KeyError as key_err:
        return jsonify({'error': f'Key error: {key_err}'}), 500
    except Exception as err:
        return jsonify({'error': f'An unexpected error occurred: {err}'}), 500


def get_tf_contents_from_run(run_doc):
    """Combine all Terraform file contents from a run document."""
    if not run_doc.tf_files:
        return None
    return "\n\n".join(
        f"# File: {tf_file.file_name}\n{tf_file.file_content}" for tf_file in run_doc.tf_files
    )


def get_tf_contents_from_upload():
    """Read and combine uploaded .tf files."""
    uploaded_files = request.files.getlist("tf_files")
    if not uploaded_files:
        return None, jsonify({"error": "No run_id provided and no Terraform files uploaded."}), 400
    tf_contents = []
    for f in uploaded_files:
        filename = f.filename
        if not filename.endswith(".tf"):
            return None, jsonify({"error": f"File {filename} is not a .tf file."}), 400
        tf_contents.append(f.read().decode("utf-8"))
    return "\n\n".join(tf_contents), None, None


def fetch_run_status(provided_run_id):
    """Fetch the Terraform run status using the provided run_id."""
    encoded_run_id = quote(provided_run_id, safe='')
    run_url = f"{BASE_URL}/runs/{encoded_run_id}"
    headers = {
        "Authorization": f"Bearer {HCPT_TOKEN}",
        "Content-Type": API_CONTENT_TYPE,
    }
    run_resp = requests.get(run_url, headers=headers)
    if run_resp.status_code != 200:
        return None, jsonify(
            {"error": f"Failed to fetch run {provided_run_id} from Terraform.", "details": run_resp.text}
        ), 400
    return run_resp.json(), None, None


def determine_error_output(provided_run_id, json_payload):
    """Determine the error output from JSON, form data, or from the Terraform API."""
    error_output = ""
    if "error_output" in json_payload and json_payload["error_output"].strip():
        error_output = json_payload["error_output"]
    elif "error_output" in request.form and request.form["error_output"].strip():
        error_output = request.form["error_output"]
    elif provided_run_id:
        # Try fetching apply logs first; if missing, try plan logs
        encoded_run_id = quote(provided_run_id, safe='')
        apply_url = f"{BASE_URL}/runs/{encoded_run_id}/apply"
        apply_logs, _ = fetch_log_from_attributes(apply_url)
        if not apply_logs:
            plan_url = f"{BASE_URL}/runs/{encoded_run_id}/plan"
            plan_logs, _ = fetch_log_from_attributes(plan_url)
            error_output = plan_logs if plan_logs else ""
        else:
            error_output = apply_logs

        if not error_output:
            error_output = "No apply or plan logs available."
        else:
            # Extract only the error message portion
            error_match = re.search(r'(Error:|error:).*', error_output, re.DOTALL)
            if error_match:
                error_output = error_match.group(0)
    else:
        error_output = json_payload.get("error_output", "No error output provided. Please try your best to identify and fix any issues with this code.")
    return error_output


def send_prompt_to_ai(user_prompt):
    """Send the prompt to the AI assistant and retrieve the fixed Terraform code."""
    thread = client.beta.threads.create(messages=[{"role": "user", "content": user_prompt}])
    run_req = client.beta.threads.runs.create(thread_id=thread.id, assistant_id=ASSISTANT_ID)
    # Poll until the AI run is completed
    while run_req.status != "completed":
        time.sleep(1)
        run_req = client.beta.threads.runs.retrieve(thread_id=thread.id, run_id=run_req.id)
    message_response = client.beta.threads.messages.list(thread_id=thread.id)
    # Choose the latest assistant message
    latest_message = next((msg for msg in message_response.data if msg.role == "assistant"), message_response.data[0])
    try:
        code = latest_message.content[0].text.value
    except (IndexError, AttributeError):
        code = latest_message.content[0].text if latest_message.content else ""
    return code


def clean_code_output(code):
    """Remove triple backticks and any language identifiers from the code."""
    match = re.search(r"```(?:\w+)?\n(.*?)```", code, re.DOTALL)
    return match.group(1).strip() if match else code.strip()

@app.route("/fix-errored-run", methods=["POST"])
def fix_errored_run():
    """
    Accepts either:
      - A run_id (in JSON payload as "run_id") to look up a stored run from MongoDB, or
      - A file (tf_files uploaded) to use directly if no run_id is provided.
    Also checks for an "error_output" field in the JSON payload and uses that for the prompt if present.
    """
    json_payload = request.get_json(silent=True) or {}
    provided_run_id = json_payload.get("run_id", "").strip()
    
    combined_tf_contents = ""
    # Get TF code from run document or uploaded files
    if provided_run_id:
        try:
            run_doc = Run.objects.get(run_id=provided_run_id)
        except DoesNotExist:
            return jsonify({"error": f"No run found with run_id: {provided_run_id}"}), 404
        except Exception as e:
            return jsonify({"error": "Database error", "details": str(e)}), 500

        combined_tf_contents = get_tf_contents_from_run(run_doc)
        if not combined_tf_contents:
            return jsonify({"error": "No .tf files associated with this run."}), 400

        run_data, error_resp, status_code = fetch_run_status(provided_run_id)
        if error_resp:
            return error_resp, status_code

        status = run_data["data"]["attributes"]["status"]
        if status != "errored":
            return jsonify({"error": f"Run {provided_run_id} is not in an errored state. Current status: {status}"}), 400
    else:
        combined_tf_contents, error_resp, status_code = get_tf_contents_from_upload()
        if error_resp:
            return error_resp, status_code

    error_output = determine_error_output(provided_run_id, json_payload)

    # Build the prompt for the AI assistant
    user_prompt = (
        "I have this Terraform configuration that produced an error.\n"
        "Here is the TF code:\n"
        "```\n"
        f"{combined_tf_contents}\n"
        "```\n"
        "Here is the error output:\n"
        "```\n"
        f"{error_output}\n"
        "```\n"
        "Please provide a fixed TF file that addresses the error."
    )

    code = send_prompt_to_ai(user_prompt)
    code = clean_code_output(code)

    fixed_filename = f"fixed_{int(time.time())}.tf"
    try:
        with open(fixed_filename, "w") as f:
            f.write(code)
    except Exception as e:
        return jsonify({"error": "Failed to write fixed TF file to disk.", "details": str(e)}), 500

    @after_this_request
    def remove_file(response):
        try:
            os.remove(fixed_filename)
        except Exception as e:
            app.logger.error("Error removing file: %s", e)
        return response

    return send_file(
        fixed_filename,
        as_attachment=True,
        download_name=fixed_filename,
        mimetype="text/plain"
    )

if __name__ == "__main__":
    try:
        connect(host=MONGODB_URI)
        app.run(debug=True, port=4000)
    except Exception as e:
        print(e)

