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
import RunCard from "./components/RunCard";

// Define the shape of a run and its nested attributes
interface StatusTimestamps {
  "queued-at": string;
  "started-at"?: string;
  "applied-at"?: string;
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

interface ApiResponse {
  data: Run[];
}

const PreviousRuns: React.FC = () => {
  const [runs, setRuns] = useState<Run[]>([]);
  const [latestAppliedId, setLatestAppliedId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [destroyError, setDestroyError] = useState<string>("");

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("http://localhost:4000/runs");
      if (!res.ok) throw new Error(`Error ${res.status}: ${res.statusText}`);
      const json: ApiResponse = await res.json();
      setRuns(json.data);

      const appliedRuns = json.data.filter(
        (r) => r.attributes.status === "applied"
      );
      if (appliedRuns.length) {
        const latest = appliedRuns.reduce((a, b) => {
          const aTime = new Date(a.attributes["status-timestamps"]["applied-at"]!);
          const bTime = new Date(b.attributes["status-timestamps"]["applied-at"]!);
          return aTime > bTime ? a : b;
        }, appliedRuns[0]); // Initial value is the first element of the array        
        setLatestAppliedId(latest.id);
      }
      setError(null);
    } catch (err) {
      console.error(err);
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDestroy = async () => {
    try {
      const res = await fetch("http://localhost:4000/destroy-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || "Unknown server error");
      }
      await fetchRuns();
    } catch (err: any) {
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
      <Box sx={{ pt: 4, pb: 6 }}>
        <Typography color="error" align="center" sx={{ pt: 4 }}>
          Error loading runs: {error.message}
        </Typography>
        <IconButton onClick={fetchRuns} aria-label="refresh">
          <RefreshIcon />
        </IconButton>
      </Box>
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
      <Dialog
        open={Boolean(destroyError)}
        onClose={() => setDestroyError("")}
      >
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
