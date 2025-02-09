import React, { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Button,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  CircularProgress
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { SystemDesign, AWSService } from '../../types/types';
import { getServiceRecommendations } from '../../services/llmService.ts';
import { getIconForService } from '../../services/iconMatcher.ts';

// Import AWS icons
import EC2Icon from 'react-aws-icons/dist/aws/logo/EC2';
import S3Icon from 'react-aws-icons/dist/aws/logo/S3';
import RDSIcon from 'react-aws-icons/dist/aws/logo/RDS';
import DynamoDBIcon from 'react-aws-icons/dist/aws/logo/DynamoDB';
import LambdaIcon from 'react-aws-icons/dist/aws/logo/Lambda';
import APIGatewayIcon from 'react-aws-icons/dist/aws/logo/APIGateway';
import CloudFrontIcon from 'react-aws-icons/dist/aws/logo/CloudFront';
import CognitoIcon from 'react-aws-icons/dist/aws/logo/Cognito';
import SESIcon from 'react-aws-icons/dist/aws/logo/SES';
import ElasticSearchIcon from 'react-aws-icons/dist/aws/logo/ES';
import WAFIcon from 'react-aws-icons/dist/aws/logo/WAF';

const AWS_ICONS = {
  'Amazon EC2': EC2Icon,
  'Amazon S3': S3Icon,
  'Amazon RDS': RDSIcon,
  'Amazon DynamoDB': DynamoDBIcon,
  'AWS Lambda': LambdaIcon,
  'Amazon API Gateway': APIGatewayIcon,
  'Amazon CloudFront': CloudFrontIcon,
  'Amazon Cognito': CognitoIcon,
  'Amazon SES': SESIcon,
  'Amazon OpenSearch': ElasticSearchIcon,
  'AWS WAF': WAFIcon,
};

interface ServiceSelectionProps {
  systemDesign: SystemDesign;
  setSystemDesign: React.Dispatch<React.SetStateAction<SystemDesign>>;
}

interface ServiceRecommendation {
  service: string;
  pros: string[];
  cons: string[];
}

interface ServiceIcon {
  serviceName: string;
  IconComponent: any;
}

export default function ServiceSelection({ systemDesign, setSystemDesign }: ServiceSelectionProps) {
  const [recommendations, setRecommendations] = useState<ServiceRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [serviceIcons, setServiceIcons] = useState<Record<string, any>>({});

  useEffect(() => {
    const fetchRecommendations = async () => {
      if (!systemDesign.name || systemDesign.requirements.length === 0) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const recs = await getServiceRecommendations(systemDesign.name, systemDesign.requirements);
        // Filter out recommendations without specific pros/cons
        const validRecs = recs.filter(rec => 
          rec.pros.length > 0 && 
          rec.cons.length > 0 && 
          rec.pros.some(pro => pro.toLowerCase().includes(systemDesign.name.toLowerCase()) || 
            systemDesign.requirements.some(req => pro.toLowerCase().includes(req.description.toLowerCase())))
        );
        setRecommendations(validRecs);
      } catch (err) {
        setError('Failed to load recommendations');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchRecommendations();
  }, [systemDesign.name, systemDesign.requirements]);

  useEffect(() => {
    const loadIcons = async () => {
      const icons: Record<string, any> = {};
      for (const rec of recommendations) {
        try {
          const iconName = await getIconForService(rec.service);
          const IconComponent = require(`react-aws-icons/dist/aws/logo/${iconName}`).default;
          icons[rec.service] = IconComponent;
        } catch (error) {
          console.error(`Error loading icon for ${rec.service}:`, error);
          icons[rec.service] = AWS_ICONS['Amazon EC2']; // Fallback icon
        }
      }
      setServiceIcons(icons);
    };

    if (recommendations.length > 0) {
      loadIcons();
    }
  }, [recommendations]);

  const handleAddService = async (rec: ServiceRecommendation) => {
    try {
      const iconName = await getIconForService(rec.service);
      const IconComponent = require(`react-aws-icons/dist/aws/logo/${iconName}`).default;
      
      const newService: AWSService = {
        id: Math.random().toString(),
        name: rec.service,
        type: rec.service.split(' ')[1] || 'Service',
        description: rec.pros[0],
        icon: iconName,
        connections: []
      };

      setSelectedServices(prev => [...prev, rec.service]);
      setSystemDesign(prev => ({
        ...prev,
        services: [...prev.services, newService]
      }));
    } catch (error) {
      console.error('Error loading icon for service:', error);
      // Proceed with default icon
      const newService: AWSService = {
        id: Math.random().toString(),
        name: rec.service,
        type: rec.service.split(' ')[1] || 'Service',
        description: rec.pros[0],
        icon: 'EC2',
        connections: []
      };

      setSelectedServices(prev => [...prev, rec.service]);
      setSystemDesign(prev => ({
        ...prev,
        services: [...prev.services, newService]
      }));
    }
  };

  const renderServiceIcon = (serviceName: string) => {
    const IconComponent = serviceIcons[serviceName] || AWS_ICONS['Amazon EC2'];
    return IconComponent ? <IconComponent size={32} /> : null;
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (recommendations.length === 0) {
    return (
      <Box textAlign="center" p={4}>
        <Typography variant="h6" gutterBottom>
          Please provide more details about your application and requirements to get service recommendations
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Recommended AWS Services for {systemDesign.name}
      </Typography>
      
      <Grid container spacing={3}>
        {recommendations.map((rec) => (
          <Grid item xs={12} key={rec.service}>
            <Accordion>
              <AccordionSummary 
                expandIcon={<ExpandMoreIcon />}
                sx={{ 
                  display: 'flex', 
                  alignItems: 'center',
                  '& .MuiAccordionSummary-content': {
                    alignItems: 'center'
                  }
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                  {renderServiceIcon(rec.service)}
                  <Typography sx={{ ml: 2 }}>{rec.service}</Typography>
                </Box>
                <Button
                  variant="contained"
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAddService(rec);
                  }}
                  disabled={selectedServices.includes(rec.service)}
                  sx={{ mr: 2 }}
                >
                  {selectedServices.includes(rec.service) ? 'Added' : 'Add Service'}
                </Button>
              </AccordionSummary>
              <AccordionDetails>
                <Typography variant="subtitle2" gutterBottom>Relevant Benefits:</Typography>
                <ul>
                  {rec.pros.map((pro, idx) => (
                    <li key={idx}>{pro}</li>
                  ))}
                </ul>
                <Typography variant="subtitle2" gutterBottom>Considerations:</Typography>
                <ul>
                  {rec.cons.map((con, idx) => (
                    <li key={idx}>{con}</li>
                  ))}
                </ul>
              </AccordionDetails>
            </Accordion>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
} 