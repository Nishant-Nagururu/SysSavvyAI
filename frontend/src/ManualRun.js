// components/ManualRun.js
import React, { useState } from 'react';
import { Box, Button, Typography, CircularProgress, Alert, Tabs, Tab, TextField } from '@mui/material';

// Function to post process error messages (remove ANSI escape codes)
const postProcessError = (text) => {
  // Remove ANSI escape codes using a regex pattern
  const ansiRegex = /\x1b\[[0-9;]*m/g;
  const cleaned = text.replace(ansiRegex, '');
  return cleaned.trim();
};

const ManualRun = () => {
  const [selectedTab, setSelectedTab] = useState(0);
  const [files, setFiles] = useState([]);
  const [description, setDescription] = useState('');
  const [generatedTF, setGeneratedTF] = useState('');
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState({ type: '', message: '' });

  const handleTabChange = (event, newValue) => {
    setSelectedTab(newValue);
    // Clear any previous alerts and state when switching tabs.
    setAlert({ type: '', message: '' });
    setFiles([]);
    setDescription('');
    setGeneratedTF('');
  };

  // Manual file upload handler
  const handleFileChange = (event) => {
    const selectedFiles = Array.from(event.target.files);
    // Filter to only include files with a .tf extension
    const terraformFiles = selectedFiles.filter(file => file.name.endsWith('.tf'));
    setFiles(terraformFiles);
    setAlert({ type: '', message: '' });
  };

  // Run handler for manual file upload
  const handleRunUpload = async () => {
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

  // Handler to call generate-tf endpoint with the description
  const handleGenerate = async () => {
    if (!description.trim()) return;

    setLoading(true);
    setAlert({ type: '', message: '' });
    try {
      const response = await fetch('http://localhost:4000/generate-tf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: description }),
      });

      if (response.ok) {
        // Assuming the API returns plain text (Terraform configuration)
        const data = await response.text();
        setGeneratedTF(data);
      } else if (response.status === 400) {
        const data = await response.json();
        const errorMessage = data.error || 'Error generating Terraform file.';
        const rawDetails = data.details || '';
        const detailsMessage = rawDetails ? ` ${postProcessError(rawDetails)}` : '';
        setAlert({ type: 'error', message: `${errorMessage}${detailsMessage}` });
      } else {
        setAlert({ type: 'error', message: 'Error generating Terraform file. Please try again.' });
      }
    } catch (error) {
      setAlert({ type: 'error', message: 'Error generating Terraform file. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  // Handler to upload the generated (and possibly edited) Terraform code
  const handleRunGenerated = async () => {
    if (!generatedTF.trim()) return;

    // Create a new file from the Terraform code text
    const tfFile = new File([generatedTF], 'main.tf', { type: 'text/plain' });
    const formData = new FormData();
    formData.append('tf_files', tfFile);

    setLoading(true);
    setAlert({ type: '', message: '' });
    try {
      const response = await fetch('http://localhost:4000/upload-terraform', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        setAlert({ type: 'success', message: 'Terraform file uploaded successfully!' });
      } else if (response.status === 400) {
        const data = await response.json();
        const errorMessage = data.error || 'Error uploading Terraform file.';
        const rawDetails = data.details || '';
        const detailsMessage = rawDetails ? ` ${postProcessError(rawDetails)}` : '';
        setAlert({ type: 'error', message: `${errorMessage}${detailsMessage}` });
      } else {
        setAlert({ type: 'error', message: 'Error uploading Terraform file. Please try again.' });
      }
    } catch (error) {
      setAlert({ type: 'error', message: 'Error uploading Terraform file. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ pt: 4 }}>
      <Typography variant="h4" gutterBottom align="center">
        Manual Run
      </Typography>
      
      {/* Tabs for switching between manual file upload and generation mode */}
      <Tabs value={selectedTab} onChange={handleTabChange} centered>
        <Tab label="Upload Files" />
        <Tab label="Generate from Description" />
      </Tabs>
      
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 4 }}>
        {selectedTab === 0 && (
          <>
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
              onClick={handleRunUpload}
            >
              {loading ? 'Uploading...' : 'Run'}
            </Button>
          </>
        )}
        {selectedTab === 1 && (
          <>
            {/* Show description text field if no generated Terraform yet */}
            {!generatedTF && (
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
                  {loading ? 'Generating...' : 'Generate'}
                </Button>
              </>
            )}
            {/* After generation, show the editable Terraform text */}
            {generatedTF && (
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
                  {loading ? 'Uploading...' : 'Run'}
                </Button>
              </>
            )}
          </>
        )}
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



// // components/ManualRun.js
// import React, { useState } from 'react';
// import { Box, Button, Typography, CircularProgress, Alert } from '@mui/material';

// // Function to post process error messages (remove ANSI escape codes)
// const postProcessError = (text) => {
//   // Remove ANSI escape codes using a regex pattern
//   const ansiRegex = /\x1b\[[0-9;]*m/g;
//   const cleaned = text.replace(ansiRegex, '');
//   return cleaned.trim();
// };

// const ManualRun = () => {
//   const [files, setFiles] = useState([]);
//   const [loading, setLoading] = useState(false);
//   const [alert, setAlert] = useState({ type: '', message: '' });

//   const handleFileChange = (event) => {
//     const selectedFiles = Array.from(event.target.files);
//     // Filter to only include files with a .tf extension
//     const terraformFiles = selectedFiles.filter(file => file.name.endsWith('.tf'));
//     setFiles(terraformFiles);
//     // Clear any previous alert when new files are selected
//     setAlert({ type: '', message: '' });
//   };

//   const handleRun = async () => {
//     if (files.length === 0) return;

//     const formData = new FormData();
//     files.forEach(file => {
//       formData.append('tf_files', file);
//     });

//     setLoading(true);
//     setAlert({ type: '', message: '' });

//     try {
//       const response = await fetch('http://localhost:4000/upload-terraform', {
//         method: 'POST',
//         body: formData,
//       });

//       if (response.ok) {
//         setAlert({ type: 'success', message: 'Files uploaded successfully!' });
//       } else if (response.status === 400) {
//         const data = await response.json();
//         // Extract error and details keys and post process the details text
//         const errorMessage = data.error || 'Error uploading files.';
//         const rawDetails = data.details || '';
//         const detailsMessage = rawDetails ? ` ${postProcessError(rawDetails)}` : '';
//         setAlert({ type: 'error', message: `${errorMessage}${detailsMessage}` });
//       } else {
//         setAlert({ type: 'error', message: 'Error uploading files. Please try again.' });
//       }
//     } catch (error) {
//       setAlert({ type: 'error', message: 'Error uploading files. Please try again.' });
//     } finally {
//       setLoading(false);
//     }
//   };

//   return (
//     <Box sx={{ pt: 4 }}>
//       <Typography variant="h4" gutterBottom align="center">
//         Manual Run
//       </Typography>
//       <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 4 }}>
//         <input
//           type="file"
//           accept=".tf"
//           multiple
//           onChange={handleFileChange}
//           style={{ marginBottom: '20px' }}
//         />
//         <Button 
//           variant="contained" 
//           color="primary" 
//           disabled={files.length === 0 || loading}
//           onClick={handleRun}
//         >
//           {loading ? 'Uploading...' : 'Run'}
//         </Button>
//         {loading && <CircularProgress sx={{ mt: 2 }} />}
//         {alert.message && (
//           <Alert severity={alert.type} sx={{ mt: 2 }}>
//             {alert.message}
//           </Alert>
//         )}
//       </Box>
//     </Box>
//   );
// };

// export default ManualRun;
