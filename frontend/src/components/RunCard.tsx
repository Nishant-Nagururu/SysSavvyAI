import { useEffect, useState, FC } from "react";
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
import FormattedApplyLogs from "./FormattedApplyLogs";

// Types
interface StatusTimestamps {
  [key: string]: string | undefined;
}

interface RunAttributes {
  status: string;
  [key: string]: any;
  "status-timestamps": StatusTimestamps;
}

interface Run {
  id: string;
  attributes: RunAttributes;
}

interface TfFile {
  file_name: string;
  file_content: string;
}

interface RunCardProps {
  run: Run;
  highlight?: boolean;
  onUpdate: () => void;
}

const RunCard: FC<RunCardProps> = ({ run, highlight = false, onUpdate }) => {
  const { attributes } = run;
  const { status, actions, message, "status-timestamps": statusTimestamps } = attributes;

  const timestampKey = `${status.replace(/_/g, "-")}-at`;
  const mostRecentTimestamp = statusTimestamps[timestampKey];

  const isDestroy = attributes["is-destroy"];
  const borderStyle = highlight ? "2px solid" : "1px solid";
  const borderColor = highlight ? "success.main" : "grey.300";

  // Cost estimates state
  const [costEstimates, setCostEstimates] = useState<any[] | null>(null);
  const [loadingCost, setLoadingCost] = useState(false);
  const [costError, setCostError] = useState<Error | null>(null);

  // Detail modal state
  const [open, setOpen] = useState(false);
  const [tfFiles, setTfFiles] = useState<TfFile[]>([]);
  const [planLog, setPlanLog] = useState("");
  const [applyLog, setApplyLog] = useState("");
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Rerun modal state
  const [rerunModalOpen, setRerunModalOpen] = useState(false);
  const [rerunCode, setRerunCode] = useState<string>("");
  const [rerunLoading, setRerunLoading] = useState(false);

  // Fix errors modal state
  const [fixLoading, setFixLoading] = useState(false);
  const [fixModalOpen, setFixModalOpen] = useState(false);
  const [fixedCode, setFixedCode] = useState<string>("");
  const [uploadLoading, setUploadLoading] = useState(false);

  // Collapse state
  const [planLogOpen, setPlanLogOpen] = useState(false);
  const [applyLogOpen, setApplyLogOpen] = useState(false);

  // Badge color
  let statusColor = "success.light";
  if (status === "errored") statusColor = "error.light";
  else if (status === "discarded" || status === "canceled") statusColor = "grey.500";

  // Fetch cost estimates
  useEffect(() => {
    if (status !== "errored") {
      setLoadingCost(true);
      fetch(`http://localhost:4000/get_cost_estimate/${run.id}`)
        .then((res) => res.json())
        .then((data) => {
          const estimates = Array.isArray(data) ? data : [data];
          setCostEstimates(estimates);
        })
        .catch((err) => setCostError(err))
        .finally(() => setLoadingCost(false));
    }
  }, [run.id, status]);

  // Load details
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
      console.error(err);
    } finally {
      setLoadingDetails(false);
    }
  };

  // Open detail modal
  const openModal = () => {
    setOpen(true);
    fetchDetails();
  };
  const closeModal = () => setOpen(false);

  // Open rerun modal
  const openRerunModal = () => {
    // Combine all files into one editable code string
    const combined = tfFiles.map((f) => f.file_content).join("\n\n");
    setRerunCode(combined);
    setRerunModalOpen(true);
  };
  const closeRerunModal = () => setRerunModalOpen(false);

  // Confirm rerun
  const handleConfirmRerun = async () => {
    setRerunLoading(true);
    try {
      const blob = new Blob([rerunCode], { type: "text/plain" });
      const formData = new FormData();
      formData.append("tf_files", blob, "main.tf");
      const res = await fetch("http://localhost:4000/upload-terraform", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      onUpdate();
      closeRerunModal();
      closeModal();
    } catch (err) {
      console.error(err);
    } finally {
      setRerunLoading(false);
    }
  };

  // Fix errors
  const handleFixErrors = async () => {
    setFixLoading(true);
    try {
      const res = await fetch("http://localhost:4000/fix-errored-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: run.id }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setFixedCode(await res.text());
      setFixModalOpen(true);
    } catch (err) {
      console.error(err);
    } finally {
      setFixLoading(false);
    }
  };

  const handleUploadFixedCode = async () => {
    setUploadLoading(true);
    try {
      const blob = new Blob([fixedCode], { type: "text/plain" });
      const formData = new FormData();
      formData.append("tf_files", blob, "main.tf");
      const res = await fetch("http://localhost:4000/upload-terraform", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error((await res.json()).details || "Error");
      setFixModalOpen(false);
      closeModal();
      onUpdate();
    } catch (err) {
      console.error(err);
    } finally {
      setUploadLoading(false);
    }
  };

  // Approve/cancel/discard
  const postAction = (endpoint: string) => {
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: run.id }),
    })
      .then(() => onUpdate())
      .catch(console.error);
  };

  return (
    <>
      <Card sx={{ mb: 2, borderRadius: 2, boxShadow: 1, border: borderStyle, borderColor }}>
        <CardContent sx={{ pb: 0 }}>
          <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: "bold" }}>
              {message}
            </Typography>
            {isDestroy && (
              <Typography variant="body2" color="error" sx={{ ml: 1, textTransform: "lowercase" }}>
                destroy run
              </Typography>
            )}
            <Typography variant="body2" sx={{ color: "text.secondary", whiteSpace: "nowrap", ml: 1 }}>
              #{run.id}
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Box sx={{ backgroundColor: statusColor, color: "white", borderRadius: 1, px: 1.5, py: 0.5, display: "inline-block" }}>
              <Typography variant="body2" sx={{ fontWeight: "bold" }}>{status}</Typography>
            </Box>
            <Typography variant="body2" sx={{ color: "text.secondary", whiteSpace: "nowrap", ml: 1 }}>
              {mostRecentTimestamp ? new Date(mostRecentTimestamp).toLocaleString() : ""}
            </Typography>
          </Box>
        </CardContent>

        {(costEstimates || costError || actions["is-confirmable"] || actions["is-cancelable"]) && (
          <CardContent sx={{ pt: 1 }}>
            {loadingCost && (
              <Typography variant="body2" color="text.secondary" mt={1}>
                Loading cost estimate...
              </Typography>
            )}
            {costEstimates && costEstimates.length > 0 && !isDestroy && !isNaN(Number(costEstimates[0]["proposed-monthly-cost"])) && (
              <Box mt={1}>
                <Box sx={{ border: "1px solid #ccc", borderRadius: 1, p: 1, mb: 1 }}>
                  <Typography variant="body2">
                    Proposed Monthly Cost: ${Number(costEstimates[0]["proposed-monthly-cost"]).toFixed(2)}
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
              {actions["is-confirmable"] && <Button size="small" variant="outlined" onClick={() => postAction("http://localhost:4000/approve-run")}>Approve Run</Button>}
              {actions["is-discardable"] && <Button size="small" variant="outlined" color="error" onClick={() => postAction("http://localhost:4000/discard-run")}>Discard Run</Button>}
              {actions["is-cancelable"] && <Button size="small" variant="outlined" color="error" onClick={() => postAction("http://localhost:4000/cancel-run")}>Cancel Run</Button>}
            </Box>
          </CardContent>
        )}

        <CardActions>
          {!isDestroy && <Button size="small" onClick={openModal}>More Details</Button>}
        </CardActions>
      </Card>

      {/* Details Dialog */}
      <Dialog open={open} onClose={closeModal} fullWidth maxWidth="xl" PaperProps={{ sx: { borderRadius: 3, height: "85vh" } }}>
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between" }}>
          Run Details — {run.id}
          <IconButton onClick={closeModal}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ height: "calc(100% - 64px)" }}>
          <Grid container spacing={2} sx={{ height: "100%" }}>
            <Grid item xs={6} sx={{ display: "flex", flexDirection: "column", width: "100%" }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
                <Typography variant="h6">Terraform Files</Typography>
                {status === "errored" ? (
                  <Button variant="contained" size="small" onClick={handleFixErrors} disabled={fixLoading} startIcon={fixLoading ? <CircularProgress size={16} /> : null}>
                    {fixLoading ? "Fixing Errors…" : "Fix Errors"}
                  </Button>
                ) : (
                  <Button variant="contained" size="small" onClick={openRerunModal} disabled={tfFiles.length === 0} startIcon={rerunLoading ? <CircularProgress size={16} /> : null}>
                    {rerunLoading ? "Running…" : "Rerun"}
                  </Button>
                )}
              </Box>
              <Box sx={{ flexGrow: 1, width: "100%", overflowY: "auto", overflowX: "hidden", border: "1px solid", borderColor: "grey.300", borderRadius: 1, p: 1 }}>
                {loadingDetails ? (
                  <Typography>Loading...</Typography>
                ) : (
                  tfFiles.map((f) => (
                    <Box key={f.file_name} sx={{ mb: 2 }}>
                      <Typography variant="subtitle2">{f.file_name}</Typography>
                      <Typography sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace" }}>
                        {f.file_content}
                      </Typography>
                    </Box>
                  ))
                )}
              </Box>
            </Grid>
            <Grid item xs={6} sx={{ display: "flex", flexDirection: "column", width: "100%" }}>
              <Box sx={{ border: "1px solid", borderColor: "grey.300", borderRadius: 1, p: 1, mb: 1 }}>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                  <Typography variant="h6">Plan Log</Typography>
                  <IconButton onClick={() => setPlanLogOpen((prev) => !prev)} size="small">
                    <ExpandMoreIcon
                      sx={{
                        transform: planLogOpen ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "transform 0.3s",
                      }}
                    />
                  </IconButton>
                </Box>
                <Collapse in={planLogOpen}>
                  <FormattedApplyLogs logText={planLog} />
                </Collapse>
              </Box>
              <Box sx={{ border: "1px solid", borderColor: "grey.300", borderRadius: 1, p: 1, mb: 1 }}>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                  <Typography variant="h6">Apply Log</Typography>
                  <IconButton onClick={() => setApplyLogOpen((prev) => !prev)} size="small">
                    <ExpandMoreIcon
                      sx={{
                        transform: applyLogOpen ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "transform 0.3s",
                      }}
                    />
                  </IconButton>
                </Box>
                <Collapse in={applyLogOpen}>
                  <FormattedApplyLogs logText={applyLog} />
                </Collapse>
              </Box>
            </Grid>
          </Grid>
        </DialogContent>
      </Dialog>

      {/* Rerun Edit Dialog */}
      <Dialog open={rerunModalOpen} onClose={closeRerunModal} fullWidth maxWidth="md" PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between" }}>
          Edit & Confirm Rerun — {run.id}
          <IconButton onClick={closeRerunModal}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <TextField
            label="Terraform Code"
            fullWidth
            multiline
            minRows={10}
            value={rerunCode}
            onChange={(e) => setRerunCode(e.target.value)}
            variant="outlined"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeRerunModal} disabled={rerunLoading}>
            Cancel
          </Button>
          <Button onClick={handleConfirmRerun} disabled={rerunLoading} variant="contained">
            {rerunLoading ? <CircularProgress size={16} /> : "Confirm Rerun"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Fix Errors Dialog */}
      <Dialog open={fixModalOpen} onClose={() => setFixModalOpen(false)} fullWidth maxWidth="md" PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between" }}>
          Fixed Code — {run.id}
          <IconButton onClick={() => setFixModalOpen(false)}>
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
            {uploadLoading ? <CircularProgress size={16} /> : "Upload Fixed Code"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default RunCard;
