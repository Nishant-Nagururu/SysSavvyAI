import React from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Box, Container, Typography } from '@mui/material';
import RequirementsWizard from './components/Wizard/RequirementsWizard.tsx';

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
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <Container maxWidth="lg">
          <Box sx={{ pt: 4, pb: 6 }}>
            <Typography variant="h3" component="h1" gutterBottom align="center">
              AWS System Designer
            </Typography>
            <Typography variant="h6" component="h2" gutterBottom align="center" color="text.secondary">
              Design your cloud architecture with ease
            </Typography>
          </Box>
          <RequirementsWizard />
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default App;
