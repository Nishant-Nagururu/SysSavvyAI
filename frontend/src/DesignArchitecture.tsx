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
import RequirementsWizard from "./components/Wizard/RequirementsWizard";
interface DesignArchitectureProps {
    onFinish: (description: string) => void;
  }

const DesignArchitecture = ({ onFinish }: DesignArchitectureProps) => {
  return (
    <>
      <Box sx={{ pt: 4, pb: 6 }}>
        <Typography variant="h3" component="h1" gutterBottom align="center">
          AWS System Designer
        </Typography>
        <Typography
          variant="h6"
          component="h2"
          gutterBottom
          align="center"
          color="text.secondary"
        >
          Describe your system and get an AWS architecture diagram
        </Typography>
      </Box>
      <RequirementsWizard onFinish={onFinish} />
    </>
  );
};

export default DesignArchitecture;
