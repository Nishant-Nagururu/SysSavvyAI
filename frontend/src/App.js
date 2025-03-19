// App.js
import React, { useState } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AppBar, Tabs, Tab, Box, Container, Typography, Toolbar } from '@mui/material';
import RequirementsWizard from './components/Wizard/RequirementsWizard.tsx';
import PreviousRuns from './PreviousRuns';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#2196f3',
    },
    secondary: {
      main: '#f50057',
    },
  },
});

function App() {
  const [tabValue, setTabValue] = useState(0);

  const handleChange = (event, newValue) => {
    setTabValue(newValue);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position="static">
        <Toolbar>
          <Tabs
            value={tabValue}
            onChange={handleChange}
            textColor="inherit"
            indicatorColor="secondary"
          >
            <Tab label="New Run" />
            <Tab label="Previous Runs" />
          </Tabs>
        </Toolbar>
      </AppBar>
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <Container maxWidth="lg">
          {tabValue === 0 ? (
            <>
              <Box sx={{ pt: 4, pb: 6 }}>
                <Typography variant="h3" component="h1" gutterBottom align="center">
                  AWS System Designer
                </Typography>
                <Typography variant="h6" component="h2" gutterBottom align="center" color="text.secondary">
                  Describe your system and get an AWS architecture diagram
                </Typography>
              </Box>
              <RequirementsWizard />
            </>
          ) : (
            <PreviousRuns />
          )}
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default App;
