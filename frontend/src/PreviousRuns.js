// PreviousRuns.js
import React, { useEffect, useState } from 'react';
import { Box, Typography, CircularProgress, Button } from '@mui/material';
import RunCard from './components/RunCard';

const PreviousRuns = () => {
  const [runs, setRuns] = useState([]);
  const [latestAppliedId, setLatestAppliedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('http://localhost:4000/runs')
      .then((res) => res.json())
      .then(({ data }) => {
        setRuns(data);
        // find the most recent “applied” run by its applied-at timestamp
        const appliedRuns = data.filter(r => r.attributes.status === 'applied');
        if (appliedRuns.length) {
          const latest = appliedRuns.reduce((a, b) => {
            const aTime = new Date(a.attributes['status-timestamps']['applied-at']);
            const bTime = new Date(b.attributes['status-timestamps']['applied-at']);
            return aTime > bTime ? a : b;
          });
          setLatestAppliedId(latest.id);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err);
        setLoading(false);
      });
  }, []);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}><CircularProgress /></Box>;
  if (error) return <Typography color="error" align="center" sx={{ pt: 4 }}>Error loading runs.</Typography>;

  return (
    <Box sx={{ pt: 4, pb: 6 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h4">Previous Runs</Typography>
      </Box>
      <Box sx={{ maxHeight: '70vh', overflowY: 'auto' }}>
        {runs.map(run => (
          <RunCard
            key={run.id}
            run={run}
            highlight={run.id === latestAppliedId}
          />
        ))}
      </Box>
    </Box>
  );
};

export default PreviousRuns;
