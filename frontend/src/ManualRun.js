// components/ManualRun.js
import React, { useState } from 'react';
import { Box, Button, Typography, CircularProgress, Alert } from '@mui/material';

// Function to post process error messages (remove ANSI escape codes)
const postProcessError = (text) => {
  // Remove ANSI escape codes using a regex pattern
  const ansiRegex = /\x1b\[[0-9;]*m/g;
  const cleaned = text.replace(ansiRegex, '');
  return cleaned.trim();
};

const ManualRun = () => {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState({ type: '', message: '' });

  const handleFileChange = (event) => {
    const selectedFiles = Array.from(event.target.files);
    // Filter to only include files with a .tf extension
    const terraformFiles = selectedFiles.filter(file => file.name.endsWith('.tf'));
    setFiles(terraformFiles);
    // Clear any previous alert when new files are selected
    setAlert({ type: '', message: '' });
  };

  const handleRun = async () => {
    if (files.length === 0) return;

    const formData = new FormData();
    files.forEach(file => {
      formData.append('tf_files', file);
    });

    setLoading(true);
    setAlert({ type: '', message: '' });

    try {
      const response = await fetch('http://localhost:4000/upload-terraform', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        setAlert({ type: 'success', message: 'Files uploaded successfully!' });
      } else if (response.status === 400) {
        const data = await response.json();
        // Extract error and details keys and post process the details text
        const errorMessage = data.error || 'Error uploading files.';
        const rawDetails = data.details || '';
        const detailsMessage = rawDetails ? ` ${postProcessError(rawDetails)}` : '';
        setAlert({ type: 'error', message: `${errorMessage}${detailsMessage}` });
      } else {
        setAlert({ type: 'error', message: 'Error uploading files. Please try again.' });
      }
    } catch (error) {
      setAlert({ type: 'error', message: 'Error uploading files. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ pt: 4 }}>
      <Typography variant="h4" gutterBottom align="center">
        Manual Run
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 4 }}>
        <input
          type="file"
          accept=".tf"
          multiple
          onChange={handleFileChange}
          style={{ marginBottom: '20px' }}
        />
        <Button 
          variant="contained" 
          color="primary" 
          disabled={files.length === 0 || loading}
          onClick={handleRun}
        >
          {loading ? 'Uploading...' : 'Run'}
        </Button>
        {loading && <CircularProgress sx={{ mt: 2 }} />}
        {alert.message && (
          <Alert severity={alert.type} sx={{ mt: 2 }}>
            {alert.message}
          </Alert>
        )}
      </Box>
    </Box>
  );
};

export default ManualRun;
