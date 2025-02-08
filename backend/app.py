import os
import tarfile
import tempfile
import requests
from flask import Flask, request, jsonify
from openai import OpenAI
import time
from mongoengine import connect
from schemas.runModel import Run, TerraformFile
import re


client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

app = Flask(__name__)

# Read environment variables
MONGODB_URI = os.environ.get("MONGODB_URI")
HCPT_TOKEN = os.environ.get("HCPT_TOKEN")
HCPT_ORG = os.environ.get("HCPT_ORG")        
HCPT_WORKSPACE = os.environ.get("HCPT_WORKSPACE")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

# Base URL for Terraform Cloud / HCP Terraform API
BASE_URL = "https://app.terraform.io/api/v2"

def get_workspace_id():
    """
    Retrieve the workspace ID given HCPT_ORG and HCPT_WORKSPACE.
    """
    url = f"{BASE_URL}/organizations/{HCPT_ORG}/workspaces/{HCPT_WORKSPACE}"
    headers = {
        "Authorization": f"Bearer {HCPT_TOKEN}",
        "Content-Type": "application/vnd.api+json",
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
        "Content-Type": "application/vnd.api+json",
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
        "Content-Type": "application/vnd.api+json",
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
        return jsonify({"error": "Missing HCPT_TOKEN environment variable."}), 500

    data = request.get_json()
    if not data or "run_id" not in data:
        return jsonify({"error": "Missing 'run_id' in JSON payload."}), 400

    run_id = data["run_id"]
    comment = data.get("comment", "Approved via API.")

    approve_url = f"{BASE_URL}/runs/{run_id}/actions/apply"
    headers = {
        "Authorization": f"Bearer {HCPT_TOKEN}",
        "Content-Type": "application/vnd.api+json",
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
        return jsonify({"error": "Missing HCPT_TOKEN environment variable."}), 500

    data = request.get_json()
    if not data or "run_id" not in data:
        return jsonify({"error": "Missing 'run_id' in JSON payload."}), 400

    run_id = data["run_id"]
    comment = data.get("comment", "Canceled via API.")

    cancel_url = f"{BASE_URL}/runs/{run_id}/actions/cancel"
    headers = {
        "Authorization": f"Bearer {HCPT_TOKEN}",
        "Content-Type": "application/vnd.api+json",
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
        return jsonify({"error": "Missing HCPT_TOKEN environment variable."}), 500

    data = request.get_json()
    if not data or "run_id" not in data:
        return jsonify({"error": "Missing 'run_id' in JSON payload."}), 400

    run_id = data["run_id"]
    comment = data.get("comment", "Discarded via API.")

    discard_url = f"{BASE_URL}/runs/{run_id}/actions/discard"
    headers = {
        "Authorization": f"Bearer {HCPT_TOKEN}",
        "Content-Type": "application/vnd.api+json",
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
        "Content-Type": "application/vnd.api+json",
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
    endpoint_url = f"{BASE_URL}/runs/{run_id}/apply"
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
    endpoint_url = f"{BASE_URL}/runs/{run_id}/plan"
    log_text, error = fetch_log_from_attributes(endpoint_url)
    if error:
        return jsonify({"error": "Failed to fetch plan log.", "details": error}), 400
    return log_text, 200


@app.route("/destroy-run", methods=["POST"])
def destroy_run():
    """
    Trigger a Terraform destroy run.
    This route creates a new run with the 'is-destroy' flag set to true.
    Expects an optional JSON payload with a 'message' attribute.
    """
    if not HCPT_TOKEN:
        return jsonify({"error": "Missing HCPT_TOKEN environment variable."}), 500

    data = request.get_json() or {}
    message = data.get("message", "Destroy triggered via API.")

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
        "Content-Type": "application/vnd.api+json"
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
    sends it to the OpenAI Chat Completion API (using the assistant with id asst_oUpYpCNZ3lnt0KfMFZNCkbbf)
    which is configured to return only Terraform (.tf) code.
    Saves the returned code in a uniquely named .tf file.
    """
    data = request.get_json()
    if not data or "message" not in data:
        return jsonify({"error": "Missing 'message' in JSON payload."}), 400

    prompt = data["message"]

    thread = client.beta.threads.create(messages=[{"role": "user", "content": prompt}])
    run = client.beta.threads.runs.create(thread_id=thread.id, assistant_id="asst_oUpYpCNZ3lnt0KfMFZNCkbbf")

    while run.status != "completed":
        time.sleep(1)
        run = client.beta.threads.runs.retrieve(thread_id=thread.id, run_id=run.id)

    message_response = client.beta.threads.messages.list(thread_id=thread.id)
    code = message_response.data[0].content[0].text.value

    if code.startswith("```"):
        # Remove the leading ``` and any language tag
        code = code.lstrip("`").lstrip()
        # Optionally, remove the language tag if present (e.g., "hcl")
        if "\n" in code:
            first_line, rest = code.split("\n", 1)
            # If the first line looks like a language identifier, remove it
            if first_line.strip().isalpha():
                code = rest
        # Remove trailing ``` if present
        if code.endswith("```"):
            code = code[:-3].strip()
    
    filename = f"generated_{int(time.time())}.tf"
    try:
        with open(filename, "w") as f:
            f.write(code)
    except Exception as e:
        return jsonify({"error": "Failed to write code to file", "details": str(e)}), 500

    return jsonify({
        "message": f"Terraform code generated and saved to {filename}",
        "filename": filename
    }), 200

@app.route('/get_cost_estimate/<run_id>', methods=['GET'])
def get_cost_estimate(run_id):
    try:
        # First API call to get run details
        run_url = f'https://app.terraform.io/api/v2/runs/{run_id}'
        headers = {
            "Authorization": f"Bearer {HCPT_TOKEN}",
            "Content-Type": "application/vnd.api+json",
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
    

@app.route("/fix-errored-run/<run_id>", methods=["POST"])
def fix_errored_run(run_id):
    """
    Accepts a run_id in the URL.
    1. Queries the MongoDB Run collection for the given run_id to get .tf files.
    2. Checks if the run has status='errored'.
    3. If yes, fetches apply logs. If apply logs are empty, fetch plan logs.
    4. Sends the file contents + error logs to the same assistant used in /generate-tf.
    5. Saves the returned, hopefully fixed, .tf code locally.
    """

    # Step 1: Query MongoDB to get the .tf file contents
    try:
        run_doc = Run.objects.get(run_id=run_id)
    except Run.DoesNotExist:
        return jsonify({"error": f"No run found with run_id: {run_id}"}), 404
    except Exception as e:
        return jsonify({"error": f"Failed to query MongoDB for run_id: {run_id}", "details": str(e)}), 500

    if not run_doc.tf_files:
        return jsonify({"error": "No .tf files associated with this run."}), 400

    # Combine all .tf file contents into one string for the AI prompt
    combined_tf_contents = "\n\n".join(
        [f"# File: {tf_file.file_name}\n{tf_file.file_content}" for tf_file in run_doc.tf_files]
    )

    # Step 2: Check run status from Terraform API
    run_url = f"{BASE_URL}/runs/{run_id}"
    headers = {
        "Authorization": f"Bearer {HCPT_TOKEN}",
        "Content-Type": "application/vnd.api+json",
    }
    run_resp = requests.get(run_url, headers=headers)
    if run_resp.status_code != 200:
        return jsonify({"error": f"Failed to fetch run {run_id} from Terraform.", "details": run_resp.text}), 400

    run_data = run_resp.json()
    status = run_data["data"]["attributes"]["status"]

    if status != "errored":
        return jsonify({"error": f"Run {run_id} is not in an errored state. Current status: {status}"}), 400

    # Step 3: Fetch apply logs, or plan logs if apply logs are empty
    endpoint_url = f"{BASE_URL}/runs/{run_id}/apply"
    apply_logs, error = fetch_log_from_attributes(endpoint_url)

    if not apply_logs:
        plan_endpoint_url = f"{BASE_URL}/runs/{run_id}/plan"
        plan_logs, plan_error = fetch_log_from_attributes(plan_endpoint_url)
        error_output = plan_logs if plan_logs else ""
    else:
        error_output = apply_logs

    if not error_output:
        error_output = "No apply or plan logs available."
    else:
        error_match = re.search(r'(Error:|error:).*', error_output, re.DOTALL)
        if error_match:
            print("FOUND MATCH")
            error_output = error_match.group(0)

    # Step 4: Construct prompt for AI
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

    # Send prompt to OpenAI assistant
    thread = client.beta.threads.create(messages=[{"role": "user", "content": user_prompt}])
    run_req = client.beta.threads.runs.create(thread_id=thread.id, assistant_id="asst_oUpYpCNZ3lnt0KfMFZNCkbbf")

    # Poll until the AI run is completed
    while run_req.status != "completed":
        time.sleep(1)
        run_req = client.beta.threads.runs.retrieve(thread_id=thread.id, run_id=run_req.id)

    # Retrieve the fixed TF code from the assistant
    message_response = client.beta.threads.messages.list(thread_id=thread.id)
    latest_message = message_response.data[-1]

    try:
        code = latest_message.content[0].text.value
    except (IndexError, AttributeError):
        code = latest_message.content[0].text if latest_message.content else ""

    # Step 5: Clean up triple backticks, optional language identifiers, etc.
    # if code.startswith("```"):
    #     code = code.lstrip("`").lstrip()
    #     if "\n" in code:
    #         first_line, rest = code.split("\n", 1)
    #         if first_line.strip().isalpha():
    #             code = rest
    #     if code.endswith("```"):
    #         code = code[:-3].strip()
    match = re.search(r"```(?:\w+)?\n(.*?)```", code, re.DOTALL)

    if match:
        code = match.group(1).strip()
    else:
        return jsonify({"error": "Assistant failed to produce valid TF file"}), 400

    # Step 6: Save the returned fixed TF code locally
    fixed_filename = f"fixed_{int(time.time())}.tf"
    try:
        with open(fixed_filename, "w") as f:
            f.write(code)
    except Exception as e:
        return jsonify({"error": "Failed to write fixed TF file to disk.", "details": str(e)}), 500

    # Step 7: Return success message
    return jsonify({
        "message": f"Fixed Terraform code saved to {fixed_filename}.",
        "fixed_filename": fixed_filename
    }), 200



if __name__ == "__main__":
    try:
        connect(host=MONGODB_URI)
        app.run(debug=True, port=4000)
    except Exception as e:
        print(e)

