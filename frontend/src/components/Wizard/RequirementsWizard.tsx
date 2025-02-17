import React, { useState } from 'react';
import { Box, Stepper, Step, StepLabel, Button, Typography, TextField, CircularProgress } from '@mui/material';
import VisualizationPreview from './VisualizationPreview.tsx';
import { SystemDesign } from '../../types/types';

// Add type definitions for process.env
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      REACT_APP_GROQ_API_KEY: string;
    }
  }
}

const steps = ['Repository & System Description', 'System Visualization'];
const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY;

async function extractFunctionInfo(content: string, filePath: string): Promise<string> {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content: `You are a code analyzer. Analyze the code and provide:
1. Overall purpose of the file
2. Key functions and their purposes
3. Data structures and types used
4. External dependencies and services
5. System design patterns identified

Format your response as:
FILE: {filename}
PURPOSE: {file's overall purpose}
KEY FUNCTIONS:
- {functionName}: {purpose and key parameters}
DATA STRUCTURES:
- {data structure/type}: {usage}
DEPENDENCIES:
- {dependency}: {how it's used}
PATTERNS:
- {pattern}: {implementation details}
---`
          },
          {
            role: 'user',
            content: `Analyze this code from ${filePath}:\n\n${content}`
          }
        ],
        model: 'llama3-70b-8192',
        temperature: 0.1,
        max_tokens: 1000
      })
    });

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Error analyzing functions:', error);
    return '';
  }
}

async function analyzeRepository(owner: string, repo: string): Promise<string> {
  try {
    // Get repository structure
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`);
    
    if (!response.ok) {
      // Try 'master' branch if 'main' fails
      const masterResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/master?recursive=1`);
      if (!masterResponse.ok) {
        throw new Error('Could not fetch repository structure');
      }
      response = masterResponse;
    }
    
    const data = await response.json();
    
    // Filter for source code files
    const sourceFiles = data.tree.filter(file => {
      const name = file.path.toLowerCase();
      return name.endsWith('.ts') ||
             name.endsWith('.tsx') ||
             name.endsWith('.js') ||
             name.endsWith('.jsx') ||
             name.endsWith('.py') ||
             name.endsWith('.java') ||
             name.endsWith('.go') ||
             name.endsWith('.rb') ||
             name.includes('dockerfile') ||
             name.includes('docker-compose') ||
             name.endsWith('.yaml') ||
             name.endsWith('.yml') ||
             name.includes('package.json') ||
             name.includes('requirements.txt');
    });

    // Get and analyze content of each file
    const analysisPromises = sourceFiles.map(async file => {
      try {
        const contentResponse = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/main/${file.path}`);
        let content;
        if (contentResponse.ok) {
          content = await contentResponse.text();
        } else {
          // Try master branch if main fails
          const masterContentResponse = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/master/${file.path}`);
          content = await masterContentResponse.text();
        }
        
        // Analyze file content
        return await extractFunctionInfo(content, file.path);
      } catch (error) {
        console.error(`Error analyzing file ${file.path}:`, error);
        return '';
      }
    });

    const fileAnalyses = (await Promise.all(analysisPromises)).filter(analysis => analysis !== '');
    console.log("this is the file analyses", fileAnalyses.join('\n\n'))
    // Summarize all analyses
    const summaryResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content: `You are a system architect. Based on the codebase analysis provided:
1. Identify the end-to-end system components and their interactions
2. List key technical requirements and constraints
3. Identify data storage and processing needs
4. Note any scalability and performance requirements
5. Highlight security and compliance considerations
6. Suggest appropriate AWS services based on these findings`
          },
          {
            role: 'user',
            content: `Analyze this codebase summary from a system architecture perspective:\n\n${fileAnalyses.join('\n\n')}`
          }
        ],
        model: 'llama3-70b-8192',
        temperature: 0.1,
        max_tokens: 1500
      })
    });

    const summaryData = await summaryResponse.json();
    return summaryData.choices[0].message.content;
  } catch (error) {
    console.error('Error analyzing repository:', error);
    return '';
  }
}

export default function RequirementsWizard() {
  const [activeStep, setActiveStep] = useState(0);
  const [systemInput, setSystemInput] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [systemDesign, setSystemDesign] = useState<SystemDesign>({
    id: '1',
    name: '',
    requirements: [],
    services: []
  });

  const handleNext = async () => {
    if (activeStep === 0) {
      setLoading(true);
      try {
        // Get repository analysis if URL is provided
        let repoAnalysis = '';
        if (repoUrl) {
          const repoUrlParts = repoUrl.replace('https://github.com/', '').split('/');
          const owner = repoUrlParts[0];
          const repo = repoUrlParts[1];
          repoAnalysis = await analyzeRepository(owner, repo);
          console.log('Repository Analysis:', repoAnalysis);
        }

        // Generate architecture with repository context
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_API_KEY}`
          },
          body: JSON.stringify({
            messages: [
              {
                role: 'system',
                content: 
`You are an AWS architecture expert. Generate a mermaid diagram for AWS architecture with service explanations. 
Use this exact format:

\`\`\`mermaid
graph TD
Service1-->Service2
Service2-->Service3
\`\`\`

DESCRIPTIONS:
Service1: Brief explanation of Service1's role in this architecture
Service2: Brief explanation of Service2's role in this architecture
Service3: Brief explanation of Service3's role in this architecture`
              },
              {
                role: 'user',
                content: `${repoAnalysis ? `Based on this repository analysis:\n${repoAnalysis}\n\n` : ''}Create a mermaid diagram for an AWS architecture for: ${systemInput}. Include all necessary AWS services and their connections. Use simple names like EC2, S3, etc. Include a brief explanation for each service's specific role in this architecture.`
              }
            ],
            model: 'llama3-70b-8192',
            temperature: 0.1,
            max_tokens: 1500
          })
        });

        const data = await response.json();
        const content = data.choices[0].message.content;
        const { services, descriptions } = parseMermaidDiagram(content);

        setSystemDesign({
          id: '1',
          name: systemInput,
          requirements: [],
          services: services.map(service => ({
            ...service,
            description: descriptions[service.id] || `${service.name} service`
          }))
        });
      } catch (error) {
        console.error('Error getting system design:', error);
      } finally {
        setLoading(false);
      }
    }
    setActiveStep((prevStep) => prevStep + 1);
  };

  const handleBack = () => {
    setActiveStep((prevStep) => prevStep - 1);
  };

  const getStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <Box sx={{ mt: 4, maxWidth: 600, mx: 'auto' }}>
            <TextField
              fullWidth
              label="GitHub Repository URL (optional)"
              variant="outlined"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="e.g., https://github.com/username/repo"
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="What system are you building?"
              variant="outlined"
              value={systemInput}
              onChange={(e) => setSystemInput(e.target.value)}
              placeholder="e.g., real-time messaging application, e-commerce platform"
            />
          </Box>
        );
      case 1:
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
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 4, alignItems: 'center' }}>
          {loading && <CircularProgress size={24} sx={{ mr: 2 }} />}
          <Button disabled={activeStep === 0} onClick={handleBack} sx={{ mr: 1 }}>
            Back
          </Button>
          <Button 
            variant="contained" 
            onClick={handleNext}
            disabled={(activeStep === 0 && !systemInput.trim()) || loading}
          >
            {activeStep === steps.length - 1 ? 'Finish' : 'Next'}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

function parseMermaidDiagram(response: string): { services: any[], descriptions: { [key: string]: string } } {
  const mermaidMatch = response.match(/```mermaid\n([\s\S]*?)\n```/);
  const descriptionsMatch = response.match(/DESCRIPTIONS:\n([\s\S]*?)(?:$|```)/);
  
  const mermaidContent = mermaidMatch ? mermaidMatch[1] : '';
  const descriptionsContent = descriptionsMatch ? descriptionsMatch[1] : '';

  const services = new Set<string>();
  const relationships: {source: string, target: string}[] = [];
  const descriptions: { [key: string]: string } = {};
  
  // Parse relationships from mermaid diagram
  mermaidContent.split('\n').forEach(line => {
    const relationMatch = line.match(/(\w+)\s*-+>+\s*(\w+)/);
    if (relationMatch && !line.includes('graph TD')) {
      const [_, source, target] = relationMatch;
      services.add(source);
      services.add(target);
      relationships.push({ source, target });
    }
  });

  // Parse service descriptions
  descriptionsContent.split('\n').forEach(line => {
    const descMatch = line.match(/(\w+):\s*(.*)/);
    if (descMatch) {
      const [_, service, description] = descMatch;
      descriptions[service] = description.trim();
    }
  });

  const serviceArray = Array.from(services).map(serviceName => ({
    id: serviceName,
    name: `Amazon ${serviceName}`,
    type: serviceName,
    description: descriptions[serviceName] || `${serviceName} service`,
    icon: serviceName.toUpperCase(),
    connections: relationships
      .filter(rel => rel.source === serviceName)
      .map(rel => rel.target)
  }));

  return { services: serviceArray, descriptions };
} 