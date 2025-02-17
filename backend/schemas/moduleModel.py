from mongoengine import Document, StringField, ListField, FloatField, ReferenceField

class ModuleChunk(Document):
    repo = StringField(required=True)
    module_name = StringField(required=True)
    chunk_content = StringField(required=True)
    embedding = ListField(FloatField())

class Module(Document):
    repo = StringField(required=True)
    module_name = StringField(required=True)
    url = StringField(required=True)
    readme_chunks = ListField(ReferenceField(ModuleChunk))  # Store references instead of embedding
