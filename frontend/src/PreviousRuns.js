import React, { useEffect, useState, useCallback } from "react";
import {
  Box,
  Typography,
  CircularProgress,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteIcon from "@mui/icons-material/Delete";
import RunCard from "./components/RunCard";

const PreviousRuns = () => {
  const [runs, setRuns] = useState([]);
  const [latestAppliedId, setLatestAppliedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [destroyError, setDestroyError] = useState("");

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("http://localhost:4000/runs");
      const { data } = await res.json();
      setRuns(data);
      const applied = data.filter((r) => r.attributes.status === "applied");
      if (applied.length) {
        const latest = applied.reduce((a, b) =>
          new Date(a.attributes["status-timestamps"]["applied-at"]) >
          new Date(b.attributes["status-timestamps"]["applied-at"])
            ? a
            : b
        );
        setLatestAppliedId(latest.id);
      }
      setError(null);
    } catch (err) {
      console.error(err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDestroy = async () => {
    try {
      const res = await fetch("http://localhost:4000/destroy-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})  // even if empty
      });
      if (!res.ok) {
        const { message } = await res.json();
        throw new Error(message || "Unknown server error");
      }
      await fetchRuns();
    } catch (err) {
      setDestroyError(err.message);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  if (loading)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", pt: 4 }}>
        <CircularProgress />
      </Box>
    );

  if (error)
    return (
      <Typography color="error" align="center" sx={{ pt: 4 }}>
        Error loading runs.
      </Typography>
    );

  return (
    <Box sx={{ pt: 4, pb: 6 }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 2,
        }}
      >
        <Typography variant="h4">Previous Runs</Typography>
        <Box>
          <Button
            size="small"
            variant="outlined"
            color="error"
            onClick={handleDestroy}
          >
            Destroy Run
          </Button>
          <IconButton onClick={fetchRuns} aria-label="refresh">
            <RefreshIcon />
          </IconButton>
        </Box>
      </Box>

      <Box sx={{ maxHeight: "70vh", overflowY: "auto" }}>
        {runs.map((run) => (
          <RunCard
            key={run.id}
            run={run}
            highlight={run.id === latestAppliedId}
            onUpdate={fetchRuns}
          />
        ))}
      </Box>

      {/* Error Modal for Destroy Run */}
      <Dialog open={Boolean(destroyError)} onClose={() => setDestroyError("")}>
        <DialogTitle>Failed to Destroy Run</DialogTitle>
        <DialogContent>
          <Typography>{destroyError}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDestroyError("")}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PreviousRuns;
