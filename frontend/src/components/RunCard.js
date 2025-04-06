// RunCard.js
import React, { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardActions,
  Typography,
  Button,
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  IconButton,
  CircularProgress,
  Collapse,
  TextField,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

const RunCard = ({ run, highlight = false, onUpdate }) => {
  const { attributes } = run;
  const {
    status,
    actions,
    message,
    "status-timestamps": statusTimestamps,
  } = attributes;

  // Convert "planned_and_finished" => "planned-and-finished-at"
  const timestampKey = status.replace(/_/g, "-") + "-at";
  const mostRecentTimestamp = statusTimestamps
    ? statusTimestamps[timestampKey]
    : null;

  const isDestroy = attributes["is-destroy"];
  const borderStyle = highlight ? "2px solid" : "1px solid";
  const borderColor = highlight ? "success.main" : "grey.300";

  const [costEstimates, setCostEstimates] = useState(null);
  const [loadingCost, setLoadingCost] = useState(false);
  const [costError, setCostError] = useState(null);

  const [open, setOpen] = useState(false);
  const [tfFiles, setTfFiles] = useState([]);
  const [planLog, setPlanLog] = useState("");
  const [applyLog, setApplyLog] = useState("");
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [rerunLoading, setRerunLoading] = useState(false);

  // Added state for toggling collapse sections
  const [planLogOpen, setPlanLogOpen] = useState(false);
  const [applyLogOpen, setApplyLogOpen] = useState(false);

  // States for fix errors flow
  const [fixLoading, setFixLoading] = useState(false);
  const [fixModalOpen, setFixModalOpen] = useState(false);
  const [fixedCode, setFixedCode] = useState("");
  const [uploadLoading, setUploadLoading] = useState(false);

  // Determine the color for the status badge
  let statusColor = "success.light"; // default
  if (status === "errored") {
    statusColor = "error.light";
  } else if (status === "discarded" || status === "canceled") {
    statusColor = "grey.500";
  }

  // Fetch cost estimate if run is not "errored"
  useEffect(() => {
    if (status !== "errored") {
      setLoadingCost(true);
      fetch(`http://localhost:4000/get_cost_estimate/${run.id}`)
        .then((res) => res.json())
        .then((data) => {
          // Ensure the data is an array.
          const estimates = Array.isArray(data) ? data : [data];
          setCostEstimates(estimates);
          setLoadingCost(false);
        })
        .catch((err) => {
          console.error("Cost estimate error:", err);
          setCostError(err);
          setLoadingCost(false);
        });
    }
  }, [run.id, status]);

  const fetchDetails = async () => {
    setLoadingDetails(true);
    try {
      const [tfRes, planRes, applyRes] = await Promise.all([
        fetch(`http://localhost:4000/get-tf/${run.id}`),
        fetch(`http://localhost:4000/plan-log/${run.id}`),
        fetch(`http://localhost:4000/apply-log/${run.id}`),
      ]);

      const tfJson = await tfRes.json();
      setTfFiles(tfJson.tf_files || []);
      setPlanLog(await planRes.text());
      setApplyLog(await applyRes.text());
    } catch (err) {
      console.error("Error loading details:", err);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleRerun = async () => {
    setRerunLoading(true);
    const formData = new FormData();
    tfFiles.forEach(({ file_name, file_content }) => {
      const blob = new Blob([file_content], { type: "text/plain" });
      formData.append("tf_files", blob, file_name);
    });

    try {
      const res = await fetch("http://localhost:4000/upload-terraform", {
        method: "POST",
        body: formData,
        mode: "cors",
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      closeModal();
      onUpdate();
    } catch (err) {
      console.error("Rerun failed:", err);
    } finally {
      setRerunLoading(false);
    }
  };

  const handleFixErrors = async () => {
    setFixLoading(true);
    try {
      const res = await fetch("http://localhost:4000/fix-errored-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: run.id }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      // Assuming the fixed code is returned as plain text.
      const fixed = await res.text();
      setFixedCode(fixed);
      setFixModalOpen(true);
    } catch (err) {
      console.error("Fix errors failed:", err);
      alert(`Error: ${err.message}`);
    } finally {
      setFixLoading(false);
    }
  };

  const handleUploadFixedCode = async () => {
    setUploadLoading(true);
    try {
      // Create a blob from the fixedCode, and add it to a FormData as main.tf.
      const blob = new Blob([fixedCode], { type: "text/plain" });
      const formData = new FormData();
      formData.append("tf_files", blob, "main.tf");

      const res = await fetch("http://localhost:4000/upload-terraform", {
        method: "POST",
        body: formData,
        mode: "cors",
      });
      if (res.status === 200) {
        alert("Terraform file uploaded successfully!");
        // Close both modals.
        setFixModalOpen(false);
        closeModal();
        onUpdate();
      } else {
        const errorJson = await res.json();
        console.error("Upload fixed code failed:", errorJson);
        const errorMsg = errorJson.details || "Unknown error";
        alert(`Error: ${errorMsg}`);
      }
    } catch (err) {
      console.error("Upload fixed code failed:", err);
      alert(`Error: ${err.message}`);
    } finally {
      setUploadLoading(false);
    }
  };

  const openModal = () => {
    setOpen(true);
    fetchDetails();
  };

  const closeModal = () => {
    setOpen(false);
  };

  const closeFixModal = () => {
    setFixModalOpen(false);
  };

  const handleApprove = () => {
    fetch("http://localhost:4000/approve-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: run.id }),
    })
      .then((res) => res.json())
      .then((data) => {
        console.log("Approved run:", data);
        onUpdate();
      })
      .catch((err) => console.error("Approve error:", err));
  };

  const handleCancel = () => {
    fetch("http://localhost:4000/cancel-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: run.id }),
    })
      .then((res) => res.json())
      .then((data) => {
        console.log("Cancelled run:", data);
        onUpdate();
      })
      .catch((err) => console.error("Cancel error:", err));
  };

  const handleDiscard = () => {
    fetch("http://localhost:4000/discard-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: run.id }),
    })
      .then((res) => res.json())
      .then((data) => {
        console.log("Discarded run:", data);
        onUpdate();
      })
      .catch((err) => console.error("Discard error:", err));
  };

  return (
    <>
      <Card
        sx={{
          mb: 2,
          borderRadius: 2,
          boxShadow: 1,
          border: borderStyle,
          borderColor,
        }}
      >
        {/* Top content row */}
        <CardContent sx={{ pb: 0 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 1,
            }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: "bold" }}>
              {message}
            </Typography>
            {isDestroy && (
              <Typography
                variant="body2"
                color="error"
                sx={{ ml: 1, textTransform: "lowercase" }}
              >
                destroy run
              </Typography>
            )}
            <Typography
              variant="body2"
              sx={{ color: "text.secondary", whiteSpace: "nowrap", ml: 1 }}
            >
              #{run.id}
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Box
              sx={{
                backgroundColor: statusColor,
                color: "white",
                borderRadius: 1,
                px: 1.5,
                py: 0.5,
                display: "inline-block",
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: "bold" }}>
                {status}
              </Typography>
            </Box>
            <Typography
              variant="body2"
              sx={{ color: "text.secondary", whiteSpace: "nowrap", ml: 1 }}
            >
              {mostRecentTimestamp
                ? new Date(mostRecentTimestamp).toLocaleString()
                : ""}
            </Typography>
          </Box>
        </CardContent>

        {(costEstimates ||
          costError ||
          actions["is-confirmable"] ||
          actions["is-cancelable"]) && (
          <CardContent sx={{ pt: 1 }}>
            {loadingCost && (
              <Typography variant="body2" color="text.secondary" mt={1}>
                Loading cost estimate...
              </Typography>
            )}
            {costEstimates &&
              costEstimates.length > 0 &&
              !isDestroy &&
              !isNaN(Number(costEstimates[0]["proposed-monthly-cost"])) && (
                <Box mt={1}>
                  <Box
                    sx={{
                      border: "1px solid #ccc",
                      borderRadius: 1,
                      p: 1,
                      mb: 1,
                    }}
                  >
                    <Typography variant="body2">
                      Proposed Monthly Cost: $
                      {Number(
                        costEstimates[0]["proposed-monthly-cost"]
                      ).toFixed(2)}
                    </Typography>
                  </Box>
                </Box>
              )}
            {costError && (
              <Typography variant="body2" color="error" mt={1}>
                Error loading cost estimates.
              </Typography>
            )}
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 1 }}>
              {actions["is-confirmable"] && (
                <Button size="small" variant="outlined" onClick={handleApprove}>
                  Approve Run
                </Button>
              )}
              {actions["is-discardable"] && (
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  onClick={handleDiscard}
                >
                  Discard Run
                </Button>
              )}
              {actions["is-cancelable"] && (
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  onClick={handleCancel}
                >
                  Cancel Run
                </Button>
              )}
            </Box>
          </CardContent>
        )}

        <CardActions>
          {!isDestroy && (
            <Button size="small" onClick={openModal}>
              More Details
            </Button>
          )}
        </CardActions>
      </Card>

      <Dialog
        open={open}
        onClose={closeModal}
        fullWidth
        maxWidth="xl"
        PaperProps={{ sx: { borderRadius: 3, height: "85vh" } }}
      >
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between" }}>
          Run Details — {run.id}
          <IconButton onClick={closeModal}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ height: "calc(100% - 64px)" }}>
          <Grid container spacing={2} sx={{ height: "100%" }}>
            {/* LEFT HALF */}
            <Grid
              item
              xs={6}
              sx={{ display: "flex", flexDirection: "column", width: "100%" }}
            >
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  mb: 1,
                }}
              >
                <Typography variant="h6">Terraform Files</Typography>
                {status === "errored" ? (
                  <Button
                    variant="contained"
                    size="small"
                    onClick={handleFixErrors}
                    disabled={fixLoading}
                    startIcon={
                      fixLoading ? <CircularProgress size={16} /> : null
                    }
                  >
                    {fixLoading ? "Fixing Errors…" : "Fix Errors"}
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    size="small"
                    onClick={handleRerun}
                    disabled={rerunLoading}
                    startIcon={
                      rerunLoading ? <CircularProgress size={16} /> : null
                    }
                  >
                    {rerunLoading ? "Running…" : "Rerun"}
                  </Button>
                )}
              </Box>

              <Box
                sx={{
                  flexGrow: 1,
                  width: "100%",
                  overflowY: "auto",
                  overflowX: "hidden",
                  border: "1px solid",
                  borderColor: "grey.300",
                  borderRadius: 1,
                  p: 1,
                }}
              >
                {loadingDetails ? (
                  <Typography>Loading...</Typography>
                ) : (
                  tfFiles.map(({ file_name, file_content }) => (
                    <Box key={file_name} sx={{ mb: 2 }}>
                      <Typography variant="subtitle2">
                        {file_name}
                      </Typography>
                      <Typography
                        sx={{
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          fontFamily: "monospace",
                        }}
                      >
                        {file_content}
                      </Typography>
                    </Box>
                  ))
                )}
              </Box>
            </Grid>
            {/* RIGHT HALF */}
            <Grid
              item
              xs={6}
              sx={{ display: "flex", flexDirection: "column", width: "100%" }}
            >
              {/* Plan Log Section */}
              <Box
                sx={{
                  border: "1px solid",
                  borderColor: "grey.300",
                  borderRadius: 1,
                  p: 1,
                  mb: 1,
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    mb: 1,
                  }}
                >
                  <Typography variant="h6">Plan Log</Typography>
                  <IconButton
                    onClick={() => setPlanLogOpen((prev) => !prev)}
                    size="small"
                  >
                    <ExpandMoreIcon
                      sx={{
                        transform: planLogOpen
                          ? "rotate(180deg)"
                          : "rotate(0deg)",
                        transition: "transform 0.3s",
                      }}
                    />
                  </IconButton>
                </Box>
                <Collapse in={planLogOpen}>
                  <Box
                    sx={{
                      maxHeight: 1000,
                      overflowY: "auto",
                      overflowX: "hidden",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontFamily: "monospace",
                    }}
                  >
                    {planLog}
                  </Box>
                </Collapse>
              </Box>

              {/* Apply Log Section */}
              <Box
                sx={{
                  border: "1px solid",
                  borderColor: "grey.300",
                  borderRadius: 1,
                  p: 1,
                  mb: 1,
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    mb: 1,
                  }}
                >
                  <Typography variant="h6">Apply Log</Typography>
                  <IconButton
                    onClick={() => setApplyLogOpen((prev) => !prev)}
                    size="small"
                  >
                    <ExpandMoreIcon
                      sx={{
                        transform: applyLogOpen
                          ? "rotate(180deg)"
                          : "rotate(0deg)",
                        transition: "transform 0.3s",
                      }}
                    />
                  </IconButton>
                </Box>
                <Collapse in={applyLogOpen}>
                  <Box
                    sx={{
                      maxHeight: 1000,
                      overflowY: "auto",
                      overflowX: "hidden",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontFamily: "monospace",
                    }}
                  >
                    {applyLog}
                  </Box>
                </Collapse>
              </Box>
            </Grid>
          </Grid>
        </DialogContent>
      </Dialog>

      {/* Fix Errors Modal */}
      <Dialog
        open={fixModalOpen}
        onClose={closeFixModal}
        fullWidth
        maxWidth="md"
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between" }}>
          Fixed Code — {run.id}
          <IconButton onClick={closeFixModal}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <TextField
            label="Fixed Code"
            fullWidth
            multiline
            minRows={10}
            value={fixedCode}
            onChange={(e) => setFixedCode(e.target.value)}
            variant="outlined"
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleUploadFixedCode}
            disabled={uploadLoading}
            variant="contained"
          >
            {uploadLoading ? (
              <CircularProgress size={16} />
            ) : (
              "Upload Fixed Code"
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default RunCard;
