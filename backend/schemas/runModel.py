from mongoengine import Document, EmbeddedDocument, StringField, ListField, EmbeddedDocumentField

# Define the structure for each Terraform file
class TerraformFile(EmbeddedDocument):
    file_name = StringField(required=True)
    file_content = StringField(required=True)

# Run Schema with tf_files as a list of TerraformFile objects
class Run(Document):
    run_id = StringField(required=True)
    tf_files = ListField(EmbeddedDocumentField(TerraformFile), required=True)
    workspace_id = StringField(required=True)
    organization_name = StringField(required=True)

