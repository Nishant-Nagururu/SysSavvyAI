import React, {
  useState,
  useCallback,
  ChangeEvent,
  SyntheticEvent,
} from "react";
import {
  Box,
  Button,
  Typography,
  CircularProgress,
  Alert,
  Tabs,
  Tab,
  TextField,
  AlertColor,
} from "@mui/material";

interface NewRunProps {
  description?: string;
}

interface AlertState {
  type: "success" | "error" | "";
  message: string;
}

// Function to post-process error messages (remove ANSI escape codes)
const postProcessError = (text: string): string => {
  const ansiRegex = /\x1b\[[0-9;]*m/g;
  return text.replace(ansiRegex, "").trim();
};

const NewRun: React.FC<NewRunProps> = ({ description: initial }) => {
  const [selectedTab, setSelectedTab] = useState<number>(initial ? 1 : 0);
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState<string>(initial || "");
  const [generatedTF, setGeneratedTF] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [alert, setAlert] = useState<AlertState>({ type: "", message: "" });

  const handleTabChange = (_: SyntheticEvent, newValue: number) => {
    setSelectedTab(newValue);
    setAlert({ type: "", message: "" });
    setFiles([]);
    setDescription("");
    setGeneratedTF("");
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    const terraformFiles = selectedFiles.filter((file) =>
      file.name.endsWith(".tf")
    );
    setFiles(terraformFiles);
    setAlert({ type: "", message: "" });
  };

  const handleRunUpload = useCallback(async () => {
    if (files.length === 0) return;
    const formData = new FormData();
    files.forEach((file) => formData.append("tf_files", file));

    setLoading(true);
    setAlert({ type: "", message: "" });

    try {
      const response = await fetch("http://localhost:4000/upload-terraform", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        setAlert({ type: "success", message: "Files uploaded successfully!" });
      } else {
        const data = await response.json();
        const errorMessage = data.error || "Error uploading files.";
        const rawDetails = data.details || "";
        const detailsMessage = rawDetails
          ? ` ${postProcessError(rawDetails)}`
          : "";
        setAlert({
          type: "error",
          message: `${errorMessage}${detailsMessage}`,
        });
      }
    } catch {
      setAlert({
        type: "error",
        message: "Error uploading files. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [files]);

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) return;

    setLoading(true);
    setAlert({ type: "", message: "" });

    try {
      const response = await fetch("http://localhost:4000/generate-tf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: description }),
      });

      if (response.ok) {
        const rawText = await response.text();
        const fenceMatch = rawText.match(/```(?:[\w-]*\n)?([\s\S]*?)```/);
        const tfCode = fenceMatch ? fenceMatch[1].trim() : rawText.trim();
        setGeneratedTF(tfCode);
      } else if (response.status === 400) {
        const data = await response.json();
        const errorMessage = data.error || "Error generating Terraform file.";
        const rawDetails = data.details || "";
        const detailsMessage = rawDetails
          ? ` ${postProcessError(rawDetails)}`
          : "";
        setAlert({
          type: "error",
          message: `${errorMessage}${detailsMessage}`,
        });
      } else {
        setAlert({
          type: "error",
          message: "Error generating Terraform file. Please try again.",
        });
      }
    } catch {
      setAlert({
        type: "error",
        message: "Error generating Terraform file. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [description]);

  const handleRunGenerated = useCallback(async () => {
    if (!generatedTF.trim()) return;

    const tfFile = new File([generatedTF], "main.tf", { type: "text/plain" });
    const formData = new FormData();
    formData.append("tf_files", tfFile);

    setLoading(true);
    setAlert({ type: "", message: "" });

    try {
      const response = await fetch("http://localhost:4000/upload-terraform", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        setAlert({
          type: "success",
          message: "Terraform file uploaded successfully!",
        });
      } else {
        const data = await response.json();
        const errorMessage = data.error || "Error uploading Terraform file.";
        const rawDetails = data.details || "";
        const detailsMessage = rawDetails
          ? ` ${postProcessError(rawDetails)}`
          : "";
        setAlert({
          type: "error",
          message: `${errorMessage}${detailsMessage}`,
        });
      }
    } catch {
      setAlert({
        type: "error",
        message: "Error uploading Terraform file. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [generatedTF]);

  return (
    <Box sx={{ pt: 4 }}>
      <Typography variant="h4" gutterBottom align="center">
        New Run
      </Typography>

      <Tabs value={selectedTab} onChange={handleTabChange} centered>
        <Tab label="Upload Files" />
        <Tab label="Generate from Description" />
      </Tabs>

      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          mt: 4,
        }}
      >
        {selectedTab === 0 && (
          <>
            <input
              type="file"
              accept=".tf"
              multiple
              onChange={handleFileChange}
              style={{ marginBottom: "20px" }}
            />
            <Button
              variant="contained"
              color="primary"
              disabled={files.length === 0 || loading}
              onClick={handleRunUpload}
            >
              {loading ? "Uploading..." : "Run"}
            </Button>
          </>
        )}

        {selectedTab === 1 && (
          <>
            {!generatedTF ? (
              <>
                <TextField
                  label="Enter Architecture Description"
                  multiline
                  rows={4}
                  variant="outlined"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  fullWidth
                  sx={{ mb: 2 }}
                />
                <Button
                  variant="contained"
                  color="primary"
                  disabled={!description.trim() || loading}
                  onClick={handleGenerate}
                >
                  {loading ? "Generating..." : "Generate"}
                </Button>
              </>
            ) : (
              <>
                <TextField
                  label="Terraform Configuration"
                  multiline
                  rows={10}
                  variant="outlined"
                  value={generatedTF}
                  onChange={(e) => setGeneratedTF(e.target.value)}
                  fullWidth
                  sx={{ mb: 2 }}
                />
                <Button
                  variant="contained"
                  color="primary"
                  disabled={!generatedTF.trim() || loading}
                  onClick={handleRunGenerated}
                >
                  {loading ? "Uploading..." : "Run"}
                </Button>
              </>
            )}
          </>
        )}

        {loading && <CircularProgress sx={{ mt: 2 }} />}
        {alert.message && (
          <Alert
            severity={
              alert.type === "" ? undefined : (alert.type as AlertColor)
            }
            sx={{ mt: 2 }}
          >
            {alert.message}
          </Alert>
        )}
      </Box>
    </Box>
  );
};

export default NewRun;
