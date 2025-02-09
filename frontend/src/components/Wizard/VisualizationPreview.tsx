import React, { useCallback } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
} from 'react-flow-renderer';
import { Box, Typography, Paper } from '@mui/material';
import { SystemDesign } from '../../types/types';

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

// Custom node component with AWS icon
const CustomNode = ({ data }) => {
  const IconComponent = AWS_ICONS[data.serviceName];
  
  return (
    <div style={{
      padding: '10px',
      borderRadius: '5px',
      background: 'white',
      border: '1px solid #ddd',
      maxWidth: '200px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
        {IconComponent && <IconComponent size={24} style={{ marginRight: '8px' }} />}
        <Typography variant="body2" style={{ fontWeight: 'bold' }}>
          {data.serviceName}
        </Typography>
      </div>
      <Typography variant="caption" style={{ display: 'block', color: '#666' }}>
        {data.description}
      </Typography>
    </div>
  );
};

interface VisualizationPreviewProps {
  systemDesign: SystemDesign;
}

export default function VisualizationPreview({ systemDesign }: VisualizationPreviewProps) {
  // Create nodes in a circular layout
  const radius = 300;
  const initialNodes = systemDesign.services.map((service, index) => {
    const angle = (index * 2 * Math.PI) / systemDesign.services.length;
    return {
      id: service.id,
      type: 'custom',
      position: {
        x: radius + radius * Math.cos(angle),
        y: radius + radius * Math.sin(angle)
      },
      data: {
        serviceName: service.name,
        description: service.description,
        icon: AWS_ICONS[service.name]
      }
    };
  });

  // Create edges with descriptions
  const initialEdges = systemDesign.services.flatMap((service, idx) => {
    const nextIdx = (idx + 1) % systemDesign.services.length;
    const nextService = systemDesign.services[nextIdx];
    
    return [{
      id: `${service.id}-${nextService.id}`,
      source: service.id,
      target: nextService.id,
      type: 'smoothstep',
      animated: true,
      label: `Connects to handle ${systemDesign.requirements[idx]?.description || 'system flow'}`,
      labelStyle: { fontSize: '10px' },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 20,
        height: 20,
      },
      style: { stroke: '#2196f3' }
    }];
  });

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges]
  );

  const nodeTypes = {
    custom: CustomNode,
  };

  return (
    <Box sx={{ height: '70vh', border: '1px solid #ddd', borderRadius: 2, overflow: 'hidden' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
      >
        <Controls />
        <Background color="#aaa" gap={16} />
      </ReactFlow>
    </Box>
  );
} 