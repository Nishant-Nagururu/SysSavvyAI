import React, { useState, KeyboardEvent } from 'react';
import {
  Box,
  Paper,
  TextField,
  IconButton,
  Typography,
  List,
  ListItem,
  ListItemText,
  CircularProgress,
  Button,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import RefreshIcon from '@mui/icons-material/Refresh';
import { SystemDesign, AWSService } from '../../types/types';

interface Message {
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
}

interface ChatBotProps {
  systemDesign: SystemDesign;
  onUpdateSystemDesign: (newDesign: SystemDesign) => void;
}

const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY;

export default function ChatBot({ systemDesign, onUpdateSystemDesign }: ChatBotProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      text: "Hi! I'm your AWS architecture assistant. I can help you refine your system design. Ask me anything about your current architecture or how to improve it!",
      sender: 'bot',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [needsRevisualization, setNeedsRevisualization] = useState(false);

  const handleRevisualize = async () => {
    setLoading(true);
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: [
                'You are an AWS architecture expert assistant. Based on the chat history and current system design, generate a complete architecture visualization.',
                'IMPORTANT: Return ONLY a JSON object in this exact format:',
                '{',
                '  "action": "update",',
                '  "services": [',
                '    {',
                '      "id": "string",',
                '      "name": "string",',
                '      "type": "string",',
                '      "description": "string",',
                '      "icon": "string",',
                '      "connections": ["string"]',
                '    }',
                '  ]',
                '}'
              ].join('\n')
            },
            {
              role: 'user',
              content: `Current system design: ${JSON.stringify(systemDesign)}\n\nChat history:\n${messages.map(m => `${m.sender}: ${m.text}`).join('\n')}\n\nPlease generate a complete architecture visualization based on the current state and chat history.`
            }
          ],
          model: 'llama3-70b-8192',
          temperature: 0.7,
          max_tokens: 1000,
        }),
      });

      const data = await response.json();
      const botResponse = data.choices[0].message.content;

      try {
        const jsonResponse = JSON.parse(botResponse);
        if (jsonResponse.action === 'update' && Array.isArray(jsonResponse.services)) {
          const updatedSystemDesign = {
            ...systemDesign,
            services: jsonResponse.services.map((service: any) => ({
              ...service,
              id: service.id.toUpperCase(),
              type: service.type.toUpperCase(),
              icon: service.icon.toUpperCase(),
              connections: service.connections?.map((conn: string) => conn.toUpperCase()) || []
            }))
          };
          
          onUpdateSystemDesign(updatedSystemDesign);
          setNeedsRevisualization(false);
          
          setMessages((prev) => [
            ...prev,
            {
              text: 'I\'ve updated the architecture visualization based on our discussion.',
              sender: 'bot',
              timestamp: new Date(),
            },
          ]);
        }
      } catch (error) {
        console.error('Error parsing visualization response:', error);
      }
    } catch (error) {
      console.error('Error getting visualization:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      text: input,
      sender: 'user',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: [
                'You are an AWS architecture expert assistant. You are helping a user refine their system design.',
                `Current system design: ${JSON.stringify(systemDesign)}`,
                '',
                'IMPORTANT: Provide natural language responses to help the user understand AWS architecture concepts and best practices.',
                'If the user\'s request implies architecture changes (e.g., removing/adding services, changing connections),',
                'end your response with: "[Architecture changes suggested - Click \'Update Visualization\' to see the changes]"',
                '',
                'Focus on:',
                '- Architecture improvements',
                '- Security best practices',
                '- Cost optimization',
                '- Performance optimization',
                '- Scalability considerations'
              ].join('\n')
            },
            ...messages.map((msg) => ({
              role: msg.sender === 'user' ? 'user' : 'assistant',
              content: msg.text,
            })),
            {
              role: 'user',
              content: input
            },
          ],
          model: 'llama3-70b-8192',
          temperature: 0.7,
          max_tokens: 1000,
        }),
      });

      const data = await response.json();
      const botResponse = data.choices[0].message.content;

      // Check if the response suggests architecture changes
      if (botResponse.includes('[Architecture changes suggested')) {
        setNeedsRevisualization(true);
      }

      setMessages((prev) => [
        ...prev,
        {
          text: botResponse,
          sender: 'bot',
          timestamp: new Date(),
        },
      ]);
    } catch (error) {
      console.error('Error getting chatbot response:', error);
      setMessages((prev) => [
        ...prev,
        {
          text: 'Sorry, I encountered an error. Please try again.',
          sender: 'bot',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Add effect to check for architecture changes in last message
  React.useEffect(() => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.sender === 'bot' && lastMessage.text.includes('[Architecture changes suggested')) {
        setNeedsRevisualization(true);
      }
    }
  }, [messages]);

  const handleKeyPress = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <Paper
      elevation={3}
      sx={{
        height: '100%',
        width: '45%', // Take up less width to fit next to flow chart
        minWidth: '500px', // Slightly reduced minimum width
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 2,
        overflow: 'hidden',
        position: 'relative', // For proper sizing
        '& .MuiList-root': {
          width: '100%',
        },
        '& .MuiListItem-root': {
          width: '100%',
          maxWidth: 'none',
        }
      }}
    >
      <Box sx={{ 
        p: 3, 
        borderBottom: 1, 
        borderColor: 'divider', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        width: '100%'
      }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>AWS Architecture Assistant</Typography>
        {needsRevisualization && (
          <Button
            variant="contained"
            color="primary"
            size="large"
            startIcon={<RefreshIcon />}
            onClick={handleRevisualize}
            disabled={loading}
            sx={{ 
              minWidth: '200px',
              ml: 2
            }}
          >
            Update Visualization
          </Button>
        )}
      </Box>

      <List
        sx={{
          flex: 1,
          overflow: 'auto',
          p: 3,
          bgcolor: 'grey.50',
          width: '100%'
        }}
      >
        {messages.map((message, index) => (
          <ListItem
            key={index}
            sx={{
              flexDirection: 'column',
              alignItems: message.sender === 'user' ? 'flex-end' : 'flex-start',
              mb: 2,
              px: 2,
              width: '100%'
            }}
          >
            <Paper
              sx={{
                p: 2,
                bgcolor: message.sender === 'user' ? 'primary.main' : 'white',
                color: message.sender === 'user' ? 'white' : 'text.primary',
                maxWidth: '85%',
                minWidth: '200px',
                width: 'fit-content',
                borderRadius: 2,
                boxShadow: 2
              }}
            >
              <ListItemText
                primary={message.text}
                primaryTypographyProps={{
                  sx: { 
                    whiteSpace: 'pre-wrap', 
                    wordBreak: 'break-word',
                    fontSize: '1rem',
                    lineHeight: 1.6
                  }
                }}
                secondary={message.timestamp.toLocaleTimeString()}
                secondaryTypographyProps={{
                  color: message.sender === 'user' ? 'white' : 'text.secondary',
                  fontSize: '0.75rem',
                  sx: { mt: 1 }
                }}
              />
            </Paper>
          </ListItem>
        ))}
      </List>

      <Box
        sx={{
          p: 3,
          borderTop: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          width: '100%'
        }}
      >
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'flex-end',
          width: '100%',
          gap: 2
        }}>
          <TextField
            fullWidth
            multiline
            maxRows={4}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e: React.KeyboardEvent<HTMLDivElement>) => handleKeyPress(e as any)}
            placeholder="Ask me about your architecture..."
            variant="outlined"
            disabled={loading}
            sx={{ 
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
                fontSize: '1rem'
              }
            }}
          />
          <IconButton
            color="primary"
            onClick={handleSend}
            disabled={loading || !input.trim()}
            sx={{
              width: 48,
              height: 48,
              bgcolor: 'primary.main',
              color: 'white',
              '&:hover': {
                bgcolor: 'primary.dark',
              },
              '&.Mui-disabled': {
                bgcolor: 'action.disabledBackground',
                color: 'action.disabled',
              }
            }}
          >
            {loading ? <CircularProgress size={24} color="inherit" /> : <SendIcon />}
          </IconButton>
        </Box>
      </Box>
    </Paper>
  );
}

// Add helper function to generate Mermaid diagram
const generateMermaidDiagram = (services: any[]): string => {
  let diagram = 'graph TD;\n';
  
  // Add nodes
  services.forEach(service => {
    diagram += `  ${service.id}[${service.name}];\n`;
  });
  
  // Add connections
  services.forEach(service => {
    if (service.connections) {
      service.connections.forEach((connection: string) => {
        diagram += `  ${service.id}-->${connection};\n`;
      });
    }
  });
  
  return diagram;
} 