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
  Grid,
  IconButton,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

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

  // inside PreviousRunsDialog (above your LEFT HALF Grid)

  const handleRerun = async () => {
    const formData = new FormData();
  
    tfFiles.forEach(({ file_name, file_content }) => {
      // Create a Blob from the text content
      const blob = new Blob([file_content], { type: "text/plain" });
      // Or: const file = new File([file_content], file_name, { type: "text/plain" });
  
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
    }
  };
  
  

  const openModal = () => {
    setOpen(true);
    fetchDetails();
  };

  const closeModal = () => {
    setOpen(false);
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
            {/* Message */}
            <Typography variant="subtitle1" sx={{ fontWeight: "bold" }}>
              {message}
            </Typography>

            {/* Destroy Run indicator */}
            {isDestroy && (
              <Typography
                variant="body2"
                color="error"
                sx={{ ml: 1, textTransform: "lowercase" }}
              >
                destroy run
              </Typography>
            )}

            {/* Run ID */}
            <Typography
              variant="body2"
              sx={{ color: "text.secondary", whiteSpace: "nowrap", ml: 1 }}
            >
              #{run.id}
            </Typography>

            {/* Spacer */}
            <Box sx={{ flexGrow: 1 }} />

            {/* Status badge */}
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

            {/* Timestamp */}
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

        {/* Cost estimates / other actions */}
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
            {costEstimates && !isDestroy && (
              <Box mt={1}>
                {costEstimates.map((item, index) => (
                  <Box
                    key={index}
                    sx={{
                      border: "1px solid #ccc",
                      borderRadius: 1,
                      p: 1,
                      mb: 1,
                    }}
                  >
                    <Typography variant="body2">
                      Proposed Monthly Cost: $
                      {Number(item["proposed-monthly-cost"]).toFixed(2)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
            {costError && (
              <Typography variant="body2" color="error" mt={1}>
                Error loading cost estimates.
              </Typography>
            )}

            {/* Bottom actions */}
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
                <Button variant="contained" size="small" onClick={handleRerun}>
                  Rerun
                </Button>
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
                      <Typography variant="subtitle2">{file_name}</Typography>
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
              <Box
                sx={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  border: "1px solid",
                  borderColor: "grey.300",
                  borderRadius: 1,
                  p: 1,
                  mb: 1,
                  overflow: "hidden",
                }}
              >
                <Typography variant="h6" sx={{ mb: 1 }}>
                  Plan Log
                </Typography>
                <Box
                  sx={{
                    flex: 1,
                    overflowY: "auto",
                    overflowX: "hidden",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: "monospace",
                  }}
                >
                  {planLog}
                </Box>
              </Box>

              <Box
                sx={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  border: "1px solid",
                  borderColor: "grey.300",
                  borderRadius: 1,
                  p: 1,
                  overflow: "hidden",
                }}
              >
                <Typography variant="h6" sx={{ mb: 1 }}>
                  Apply Log
                </Typography>
                <Box
                  sx={{
                    flex: 1,
                    overflowY: "auto",
                    overflowX: "hidden",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: "monospace",
                  }}
                >
                  {applyLog}
                </Box>
              </Box>
            </Grid>
          </Grid>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default RunCard;
