// App.js
import React, { useState } from "react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import {
  AppBar,
  Tabs,
  Tab,
  Box,
  Container,
  Typography,
  Toolbar,
} from "@mui/material";
import RequirementsWizard from "./components/Wizard/RequirementsWizard.tsx";
import NewRun from "./NewRun";
import PreviousRuns from "./PreviousRuns";
import DesignArchitecture from "DesignArchitecture";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#2196f3",
    },
    secondary: {
      main: "#f50057",
    },
  },
});

function App() {
  const [tabValue, setTabValue] = useState(0);
  const [description, setDescription] = useState("");

  const handleChange = (event, newValue) => {
    setTabValue(newValue);
  };

  const handleWizardFinish = (desc) => {
    setDescription(desc); // store it
    setTabValue(1); // switch to Manual Run tab
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
            <Tab label="Design Architecture" />
            <Tab label="New Run" />
            <Tab label="Previous Runs" />
          </Tabs>
        </Toolbar>
      </AppBar>
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
        <Container maxWidth="lg">
          {tabValue === 0 && <DesignArchitecture onFinish={handleWizardFinish} />}
          {tabValue === 1 && <NewRun description={description}/>}
          {tabValue === 2 && <PreviousRuns />}
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default App;
