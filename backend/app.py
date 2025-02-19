import os
import tarfile
import tempfile
import requests
from flask import Flask, request, jsonify
from openai import OpenAI
import time
from mongoengine import connect
from schemas.runModel import Run, TerraformFile
from schemas.moduleModel import Module, ModuleChunk
import re
from dotenv import load_dotenv
import base64
from openai import OpenAI

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

app = Flask(__name__)

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

def get_file_from_folder(repo, folder_path, target_file):
    """
    Fetches the content of target_file (e.g. main.tf) from a given folder in a repo.
    Returns a tuple (content, html_url) if found; otherwise, (None, None).
    """
    contents = get_contents(repo, folder_path)
    if not contents:
        return None, None
    for item in contents:
        if item["type"] == "file" and item["name"].lower() == target_file.lower():
            file_response = requests.get(item["url"], headers=GITHUB_HEADERS)
            if file_response.status_code == 200:
                file_data = file_response.json()
                if file_data.get("encoding") == "base64" and "content" in file_data:
                    try:
                        content_decoded = base64.b64decode(file_data["content"]).decode("utf-8")
                    except Exception as e:
                        print(f"Error decoding content for {repo} - {folder_path}/{target_file}: {e}")
                        content_decoded = None
                else:
                    content_decoded = file_data.get("content")
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

# def upload_to_vector_store(file_path):
#     """
#     Placeholder function for uploading a file to your vector store via the OpenAI client.
#     Replace the content of this function with your actual upload logic.
#     """
#     try:
#         # Example: using a hypothetical method on openai_client.
#         response = client.files.create(file=open(file_path, "rb"),
#         purpose="assistants")
#         file_id = response.id
#         print("FILE ID:", file_id)
#         return file_id
#     except Exception as e:
#         print(f"Error uploading file {file_path}: {e}")
#         return None

# @app.route("/store-readmes", methods=["POST"])
# def store_readmes():
#     """
#     Fetches repositories from the 'terraform-aws-modules' GitHub organization,
#     iterates over each repo to look for a top-level 'modules' folder, then for each
#     module folder looks for a README.md file. For each README, a header is added,
#     the content is saved as a text file, and the file is uploaded to a vector store
#     using the OpenAI client.
#     """
#     GITHUB_ORG = "terraform-aws-modules"
#     GITHUB_API_URL = "https://api.github.com"
#     headers = {}
#     token = os.getenv("GITHUB_TOKEN")
#     if token:
#         headers["Authorization"] = f"token {token}"

#     def get_repos(org):
#         url = f"{GITHUB_API_URL}/orgs/{org}/repos?per_page=100"
#         response = requests.get(url, headers=headers)
#         if response.status_code != 200:
#             return []
#         return response.json()

#     def get_contents(repo, path):
#         url = f"{GITHUB_API_URL}/repos/{GITHUB_ORG}/{repo}/contents/{path}"
#         response = requests.get(url, headers=headers)
#         if response.status_code == 200:
#             return response.json()
#         return None

#     def get_readme_from_folder(repo, folder_path):
#         contents = get_contents(repo, folder_path)
#         if not contents:
#             return None, None
#         for item in contents:
#             if item["type"] == "file" and item["name"].lower() == "readme.md":
#                 file_response = requests.get(item["url"], headers=headers)
#                 if file_response.status_code == 200:
#                     file_data = file_response.json()
#                     if file_data.get("encoding") == "base64" and "content" in file_data:
#                         try:
#                             content_decoded = base64.b64decode(file_data["content"]).decode("utf-8")
#                         except Exception as e:
#                             print(f"Error decoding content for {repo} - {folder_path}: {e}")
#                             content_decoded = None
#                     else:
#                         content_decoded = file_data.get("content")
#                     return content_decoded, item.get("html_url")
#         return None, None

#     repos = get_repos(GITHUB_ORG)
#     if not repos:
#         return jsonify({"error": "No repositories found in organization."}), 404

#     # Ensure that the directory for storing text files exists.
#     output_dir = "readmes"
#     os.makedirs(output_dir, exist_ok=True)

#     total_modules = 0
#     file_ids = []
#     for repo in repos:
#         repo_name = repo["name"]
#         modules = get_contents(repo_name, "modules")
#         if not modules:
#             continue
#         for module in modules:
#             if module["type"] != "dir":
#                 continue
#             module_name = module["name"]
#             folder_path = f"modules/{module_name}"
#             readme_content, readme_url = get_readme_from_folder(repo_name, folder_path)
#             if readme_content:
#                 # Build the header.
#                 header = f"# Repo: {repo_name}, Module: {module_name}"
#                 # Prepend the header to the original README.
#                 full_readme = header + "\n\n" + readme_content

#                 # Define a file path to save the README.
#                 safe_repo = repo_name.replace(" ", "_")
#                 safe_module = module_name.replace(" ", "_")
#                 file_name = f"{safe_repo}_{safe_module}_README.txt"
#                 file_path = os.path.join(output_dir, file_name)

#                 try:
#                     with open(file_path, "w", encoding="utf-8") as f:
#                         f.write(full_readme)
#                     print(f"Saved README for {repo_name}/{module_name} to {file_path}")
#                 except Exception as e:
#                     print(f"Error writing file {file_path}: {e}")
#                     continue

#                 # Prepare metadata (you can extend this with more details as needed).
#                 metadata = {
#                     "repo": repo_name,
#                     "module": module_name,
#                     "readme_url": readme_url or ""
#                 }

#                 # Upload the file to the vector store.
#                 file_id = upload_to_vector_store(file_path)
#                 if file_id:
#                     file_ids.append(file_id)

#                 total_modules += 1

#     chunk_size = 10
#     batch_results = []
#     for i in range(0, len(file_ids), chunk_size):
#         chunk = file_ids[i:min(i + chunk_size, len(file_ids))]
#         batch_add = client.beta.vector_stores.file_batches.create(
#             vector_store_id=VECTOR_STORE_ID,
#             file_ids=chunk
#         )
#         # Optionally, wait briefly before processing the next chunk
#         time.sleep(1)
#         print("Batch status for chunk starting at index", i, ":", batch_add.status)
#         batch_results.append({"file_ids": chunk, "batch_status": batch_add.status})
    
#     return jsonify({"message": f"Processed and uploaded README for {total_modules} module(s) from GitHub.", "batches": batch_results}), 200


# @app.route("/store-readmes", methods=["POST"])
# def store_readmes():
#     """
#     Fetches repositories from the 'terraform-aws-modules' GitHub organization,
#     iterates over each repo to look for a top-level 'modules' folder, then for each
#     module folder looks for a README.md file. For each README, the content is split
#     into chunks as follows:
#       - Everything prior to the first "##" header is treated as a preamble.
#       - The preamble is cleaned by removing the string "<!-- BEGIN_TF_DOCS -->" if present.
#       - Every section that starts with a "##" header will have the cleaned preamble prepended
#         to it.
#     An embedding is computed for each chunk, and ModuleChunk documents are created and
#     referenced by a Module document.
#     """
#     GITHUB_ORG = "terraform-aws-modules"
#     GITHUB_API_URL = "https://api.github.com"
#     headers = {}
#     token = os.getenv("GITHUB_TOKEN")
#     if token:
#         headers["Authorization"] = f"token {token}"

#     def get_repos(org):
#         url = f"{GITHUB_API_URL}/orgs/{org}/repos?per_page=100"
#         response = requests.get(url, headers=headers)
#         if response.status_code != 200:
#             return []
#         return response.json()

#     def get_contents(repo, path):
#         url = f"{GITHUB_API_URL}/repos/{GITHUB_ORG}/{repo}/contents/{path}"
#         response = requests.get(url, headers=headers)
#         if response.status_code == 200:
#             return response.json()
#         return None

#     def get_readme_from_folder(repo, folder_path):
#         contents = get_contents(repo, folder_path)
#         if not contents:
#             return None, None
#         for item in contents:
#             if item["type"] == "file" and item["name"].lower() == "readme.md":
#                 file_response = requests.get(item["url"], headers=headers)
#                 if file_response.status_code == 200:
#                     file_data = file_response.json()
#                     if file_data.get("encoding") == "base64" and "content" in file_data:
#                         try:
#                             content_decoded = base64.b64decode(file_data["content"]).decode("utf-8")
#                         except Exception as e:
#                             print(f"Error decoding content for {repo} - {folder_path}: {e}")
#                             content_decoded = None
#                     else:
#                         content_decoded = file_data.get("content")
#                     return content_decoded, item.get("html_url")
#         return None, None

#     repos = get_repos(GITHUB_ORG)
#     if not repos:
#         return jsonify({"error": "No repositories found in organization."}), 404

#     total_modules = 0
#     for repo in repos:
#         repo_name = repo["name"]
#         modules = get_contents(repo_name, "modules")
#         if not modules:
#             continue
#         for module in modules:
#             if module["type"] != "dir":
#                 continue
#             module_name = module["name"]
#             folder_path = f"modules/{module_name}"
#             readme_content, readme_url = get_readme_from_folder(repo_name, folder_path)
#             if readme_content:
#                 # Build the base header.
#                 header = f"# Repo: {repo_name}, Module: {module_name}"
#                 # Prepend the header to the original README.
#                 full_readme = header + "\n\n" + readme_content

#                 # Look for the first occurrence of a "##" header.
#                 import re
#                 match = re.search(r"(?m)^##", full_readme)
#                 if not match:
#                     # If no "##" sections exist, use the full_readme as a single chunk.
#                     chunks = [full_readme]
#                 else:
#                     # Extract preamble as everything before the first "##" header.
#                     preamble = full_readme[:match.start()].strip()
#                     # Remove the unwanted string if it exists.
#                     preamble = preamble.replace("<!-- BEGIN_TF_DOCS -->", "").strip()
#                     # Split the remainder into sections starting with "##".
#                     sections = re.split(r"(?m)(?=^##)", full_readme[match.start():])
#                     # For every section starting with "##", prepend the cleaned preamble.
#                     chunks = [preamble + "\n\n" + section.strip() for section in sections if section.strip()]

#                 chunk_refs = []
#                 for chunk_text in chunks:
#                     try:
#                         embedding = get_readme_embedding(chunk_text)
#                     except Exception as e:
#                         print(f"Error generating embedding for {repo_name} - {module_name}: {e}")
#                         embedding = []
#                     module_chunk = ModuleChunk(
#                         repo=repo_name,
#                         module_name=module_name,
#                         chunk_content=chunk_text,
#                         embedding=embedding
#                     )
#                     module_chunk.save()
#                     chunk_refs.append(module_chunk)

#                 mod_doc = Module(
#                     repo=repo_name,
#                     module_name=module_name,
#                     url=readme_url or "",
#                     readme_chunks=chunk_refs
#                 )
#                 mod_doc.save()
#                 total_modules += 1

#     return jsonify({"message": f"Stored README chunks for {total_modules} module(s) from GitHub."}), 200


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
    sends it to the OpenAI Chat Completion API (using the assistant with id ASSISTANT_ID)
    which is configured to return only Terraform (.tf) code.
    Saves the returned code in a uniquely named .tf file.
    """
    data = request.get_json()
    if not data or "message" not in data:
        return jsonify({"error": "Missing 'message' in JSON payload."}), 400

    prompt = data["message"]

    thread = client.beta.threads.create(messages=[{"role": "user", "content": prompt}])
    run = client.beta.threads.runs.create(thread_id=thread.id, assistant_id="ASSISTANT_ID")

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
    run_req = client.beta.threads.runs.create(thread_id=thread.id, assistant_id="ASSISTANT_ID")

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

