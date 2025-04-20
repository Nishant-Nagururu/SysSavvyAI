import React, { useState } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
} from 'react-flow-renderer';
import { Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions, Button, Grid } from '@mui/material';
import { SystemDesign } from '../../types/types';
import StorageIcon from '@mui/icons-material/Storage';
import CloudIcon from '@mui/icons-material/Cloud';
import SecurityIcon from '@mui/icons-material/Security';
import DnsIcon from '@mui/icons-material/Dns';
import RouterIcon from '@mui/icons-material/Router';
import MemoryIcon from '@mui/icons-material/Memory';
import HttpIcon from '@mui/icons-material/Http';
import LayersIcon from '@mui/icons-material/Layers';
import SearchIcon from '@mui/icons-material/Search';
import DataObjectIcon from '@mui/icons-material/DataObject';
import MonitorIcon from '@mui/icons-material/Monitor';
import FolderIcon from '@mui/icons-material/Folder';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import ChatBot from './ChatBot';

const AWS_ICONS: { [key: string]: React.ComponentType } = {
  'EC2': MemoryIcon,
  'S3': StorageIcon,
  'RDS': StorageIcon,
  'DYNAMODB': StorageIcon,
  'LAMBDA': CloudIcon,
  'APIGATEWAY': HttpIcon,
  'CLOUDFRONT': CloudIcon,
  'COGNITO': SecurityIcon,
  'SES': HttpIcon,
  'ES': SearchIcon,
  'WAF': SecurityIcon,
  'CLOUDWATCH': MonitorIcon,
  'ECS': DataObjectIcon,
  'EFS': FolderIcon,
  'IAM': SecurityIcon,
  'VPC': RouterIcon,
  'SNS': AccountTreeIcon,
  'SQS': AccountTreeIcon,
  'DEFAULT': DnsIcon
};

interface VisualizationPreviewProps {
  systemDesign: SystemDesign;
  onUpdateSystemDesign: (newDesign: SystemDesign) => void;
}

const VisualizationPreview: React.FC<VisualizationPreviewProps> = ({ systemDesign, onUpdateSystemDesign }) => {
  const [selectedService, setSelectedService] = useState<any>(null);

  const handleNodeClick = (event: React.MouseEvent, node: Node) => {
    const service = systemDesign.services.find(s => s.id === node.id);
    setSelectedService(service);
  };

  const handleCloseDialog = () => {
    setSelectedService(null);
  };

  const handleUpdateSystemDesign = (newDesign: SystemDesign) => {
    onUpdateSystemDesign(newDesign);
    // Create nodes from updated services
    const updatedNodes: Node[] = newDesign.services.map((service, index) => ({
      id: service.id,
      type: 'default',
      data: { 
        label: (
          <div style={{ textAlign: 'center' }}>
            {React.createElement(AWS_ICONS[service.icon] || AWS_ICONS['DEFAULT'], {
              sx: { fontSize: 40, marginBottom: '8px' },
              color: "primary"
            } as any)}
            <div>{service.name}</div>
          </div>
        )
      },
      position: { 
        x: 150 + (index % 3) * 250, 
        y: 100 + Math.floor(index / 3) * 200 
      },
      style: {
        background: '#fff',
        border: '1px solid #ddd',
        borderRadius: '8px',
        padding: '10px',
        width: 180,
        height: 100,
        cursor: 'pointer'
      }

    }));

    // Create edges from updated service connections
    const updatedEdges: Edge[] = newDesign.services.flatMap(service =>
      service.connections.map(targetId => ({
        id: `${service.id}-${targetId}`,
        source: service.id,
        target: targetId,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#2196f3' },
      }))
    );

    setNodes(updatedNodes);
    setEdges(updatedEdges);
  };

  // Create initial nodes from services
  const initialNodes: Node[] = systemDesign.services.map((service, index) => ({
    id: service.id,
    type: 'default',
    data: { 
      label: (
        <div style={{ textAlign: 'center' }}>
          {React.createElement(AWS_ICONS[service.icon] || AWS_ICONS['DEFAULT'], {
            sx: { fontSize: 40, marginBottom: '8px' },
            color: "primary"
          } as any)}
          <div>{service.name}</div>
        </div>
      )
    },
    position: { 
      x: 150 + (index % 3) * 250, 
      y: 100 + Math.floor(index / 3) * 200 
    },
    style: {
      background: '#fff',
      border: '1px solid #ddd',
      borderRadius: '8px',
      padding: '10px',
      width: 180,
      height: 100,
      cursor: 'pointer'
    }
  }));

  // Create edges from service connections
  const initialEdges: Edge[] = systemDesign.services.flatMap(service =>
    service.connections.map(targetId => ({
      id: `${service.id}-${targetId}`,
      source: service.id,
      target: targetId,
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#2196f3' },
    }))
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  return (
    <Box sx={{ width: '100%', height: '70vh', border: '1px solid #ddd', borderRadius: 2 }}>
      {systemDesign.services.length > 0 ? (
        <Grid container spacing={2} sx={{ height: '100%' }}>
          <Grid item xs={9} sx={{ height: '100%' }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={handleNodeClick}
              fitView
              attributionPosition="bottom-left"
            >
              <Controls />
              <Background />
            </ReactFlow>
          </Grid>
          <Grid item xs={3} sx={{ height: '100%', pl: 0 }}>
            <ChatBot 
              systemDesign={systemDesign}
              onUpdateSystemDesign={handleUpdateSystemDesign}
            />
          </Grid>
        </Grid>
      ) : (
        <Box
          sx={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Typography variant="h6" color="text.secondary">
            No services to display. Please go back and try again.
          </Typography>
        </Box>
      )}

      <Dialog open={!!selectedService} onClose={handleCloseDialog}>
        <DialogTitle>
          {selectedService?.name}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {selectedService?.description}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default VisualizationPreview; 