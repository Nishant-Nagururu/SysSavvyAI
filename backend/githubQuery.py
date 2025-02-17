import requests
import base64

ORG = "terraform-aws-modules"
API_URL = "https://api.github.com"

def get_repos(org):
    """
    Retrieves the list of repositories in the organization.
    """
    url = f"{API_URL}/orgs/{org}/repos"
    response = requests.get(url)
    response.raise_for_status()
    return response.json()

def get_contents(owner, repo, path):
    """
    Gets the contents of a given path in a repository.
    """
    url = f"{API_URL}/repos/{owner}/{repo}/contents/{path}"
    response = requests.get(url)
    if response.status_code == 200:
        return response.json()
    return None

def get_readme_from_folder(owner, repo, folder_path):
    """
    Searches for a file named 'README.md' (case insensitive) in the specified folder.
    If found, returns the decoded file content.
    """
    contents = get_contents(owner, repo, folder_path)
    if not contents:
        return None
    for item in contents:
        if item['type'] == 'file' and item['name'].lower() == 'readme.md':
            # The file content is base64-encoded.
            file_data = requests.get(item['url']).json()
            return base64.b64decode(file_data['content']).decode('utf-8')
    return None

def main():
    repos = get_repos(ORG)
    # for repo in repos:
    repo_name = repos[0]['name']
    print(f"Processing repository: {repo_name}")
    modules = get_contents(ORG, repo_name, "modules")
    if not modules:
        print("  No 'modules' folder found.\n")
        return
        # continue
    for module in modules:
        if module['type'] == "dir":
            folder_path = f"modules/{module['name']}"
            readme_content = get_readme_from_folder(ORG, repo_name, folder_path)
            if readme_content:
                print(f"\nRepo: {repo_name}, Module: {module['name']}")
                print("-" * 80)
                print(readme_content)
                print("-" * 80)
            else:
                print(f"  No README.md found in module {module['name']}")
    print("\n" + "=" * 100 + "\n")

if __name__ == "__main__":
    main()
