import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  FormControl,
  RadioGroup,
  FormControlLabel,
  Radio,
  Chip,
  TextField,
  Paper
} from '@mui/material';
import { SystemRequirement, SystemDesign } from '../../types/types';

const commonRequirements = {
  functional: [
    'User Authentication',
    'Data Storage',
    'API Integration',
    'Real-time Processing',
    'File Upload/Download',
    'Email Notifications',
    'Search Functionality'
  ],
  nonFunctional: [
    'High Availability',
    'Scalability',
    'Security',
    'Performance',
    'Cost Optimization',
    'Disaster Recovery',
    'Compliance'
  ]
};

interface RequirementsFormProps {
  systemDesign: SystemDesign;
  setSystemDesign: React.Dispatch<React.SetStateAction<SystemDesign>>;
}

export default function RequirementsForm({ systemDesign, setSystemDesign }: RequirementsFormProps) {
  const [selectedRequirements, setSelectedRequirements] = useState<string[]>([]);

  const handleRequirementSelect = (requirement: string, type: string) => {
    if (selectedRequirements.includes(requirement)) {
      setSelectedRequirements(prev => prev.filter(r => r !== requirement));
      setSystemDesign(prev => ({
        ...prev,
        requirements: prev.requirements.filter(r => r.description !== requirement)
      }));
    } else {
      setSelectedRequirements(prev => [...prev, requirement]);
      setSystemDesign(prev => ({
        ...prev,
        requirements: [
          ...prev.requirements,
          {
            id: Math.random().toString(),
            type: type === 'functional' ? 'functional' : 'nonFunctional',
            description: requirement,
            relatedServices: []
          }
        ]
      }));
    }
  };

  const handleApplicationTypeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSystemDesign(prev => ({
      ...prev,
      name: event.target.value
    }));
  };

  return (
    <Box>
      <TextField
        fullWidth
        label="What type of application are you building?"
        variant="outlined"
        value={systemDesign.name}
        onChange={handleApplicationTypeChange}
        sx={{ mb: 4 }}
        placeholder="e.g., E-commerce platform, Social media app, Data analytics system"
      />
      
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="subtitle1" gutterBottom>
            Functional Requirements
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {commonRequirements.functional.map((req) => (
              <Chip
                key={req}
                label={req}
                onClick={() => handleRequirementSelect(req, 'functional')}
                color={selectedRequirements.includes(req) ? 'primary' : 'default'}
                variant={selectedRequirements.includes(req) ? 'filled' : 'outlined'}
                clickable
              />
            ))}
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="subtitle1" gutterBottom>
            Non-Functional Requirements
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {commonRequirements.nonFunctional.map((req) => (
              <Chip
                key={req}
                label={req}
                onClick={() => handleRequirementSelect(req, 'nonFunctional')}
                color={selectedRequirements.includes(req) ? 'primary' : 'default'}
                variant={selectedRequirements.includes(req) ? 'filled' : 'outlined'}
                clickable
              />
            ))}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
} 