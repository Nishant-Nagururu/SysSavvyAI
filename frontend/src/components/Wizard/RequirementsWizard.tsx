import React, { useState } from 'react';
import { Box, Stepper, Step, StepLabel, Button, Typography } from '@mui/material';
import RequirementsForm from './RequirementsForm.tsx';
import ServiceSelection from './ServiceSelection.tsx';
import VisualizationPreview from './VisualizationPreview.tsx';

const steps = ['System Requirements', 'AWS Services', 'Visualization'];

export default function RequirementsWizard() {
  const [activeStep, setActiveStep] = useState(0);
  const [systemDesign, setSystemDesign] = useState<SystemDesign>({
    id: '',
    name: '',
    requirements: [],
    services: []
  });

  const handleNext = () => {
    setActiveStep((prevStep) => prevStep + 1);
  };

  const handleBack = () => {
    setActiveStep((prevStep) => prevStep - 1);
  };

  const getStepContent = (step: number) => {
    switch (step) {
      case 0:
        return <RequirementsForm systemDesign={systemDesign} setSystemDesign={setSystemDesign} />;
      case 1:
        return <ServiceSelection systemDesign={systemDesign} setSystemDesign={setSystemDesign} />;
      case 2:
        return <VisualizationPreview systemDesign={systemDesign} />;
      default:
        return 'Unknown step';
    }
  };

  return (
    <Box sx={{ width: '100%', p: 4 }}>
      <Stepper activeStep={activeStep}>
        {steps.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>
      <Box sx={{ mt: 4 }}>
        {getStepContent(activeStep)}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 4 }}>
          <Button disabled={activeStep === 0} onClick={handleBack} sx={{ mr: 1 }}>
            Back
          </Button>
          <Button variant="contained" onClick={handleNext}>
            {activeStep === steps.length - 1 ? 'Finish' : 'Next'}
          </Button>
        </Box>
      </Box>
    </Box>
  );
} 