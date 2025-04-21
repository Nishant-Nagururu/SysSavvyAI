import React, { useState } from 'react';
import { Box, Stepper, Step, StepLabel, Button, Typography, TextField, CircularProgress } from '@mui/material';
import VisualizationPreview from './VisualizationPreview';
import { SystemDesign } from '../../types/types';
import { on } from 'events';

// Add type definitions for process.env
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      REACT_APP_GROQ_API_KEY: string;
    }
  }
}

// Add interface for GitHub tree item
interface GitHubTreeItem {
  path: string;
  type: string;
  sha: string;
  url: string;
}

interface GitHubTreeResponse {
  tree: GitHubTreeItem[];
  truncated: boolean;
  sha: string;
  url: string;
}

const steps = ['Repository & System Description', 'System Visualization'];
const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY;

// Fetch wrapper to continue feteching if there is a rate limit
async function fetchWithRetry(
  input: RequestInfo,
  init?: RequestInit,
  retries = 3,
  defaultDelay = 1000
): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status === 429 && retries > 0) {
    const retryAfter = res.headers.get('Retry-After')
    const delayMs = retryAfter ? parseFloat(retryAfter) * 1000 : defaultDelay
    await new Promise(r => setTimeout(r, delayMs))
    return fetchWithRetry(input, init, retries - 1, defaultDelay)
  }
  return res
}

interface TreeNode {
  name: string
  children?: Record<string, TreeNode>
  isFile: boolean
}

// Helper to insert a path into the in‑memory tree
function insertPath(root: TreeNode, parts: string[]): void {
  if (parts.length === 0) return
  const [head, ...rest] = parts
  root.children = root.children || {}
  if (!root.children[head]) {
    root.children[head] = { name: head, isFile: rest.length === 0, children: {} }
  }
  insertPath(root.children[head], rest)
}

// Render ASCII tree lines
function renderTree(node: TreeNode, prefix = ''): string[] {
  const lines: string[] = []
  const entries = node.children
    ? Object.values(node.children).sort((a, b) => {
        // directories first
        if (a.isFile !== b.isFile) return a.isFile ? 1 : -1
        return a.name.localeCompare(b.name)
      })
    : []

  entries.forEach((child, idx) => {
    const isLast = idx === entries.length - 1
    const pointer = isLast ? '└── ' : '├── '
    lines.push(`${prefix}${pointer}${child.name}`)
    if (!child.isFile && child.children) {
      const extension = isLast ? '    ' : '│   '
      lines.push(...renderTree(child, prefix + extension))
    }
  })

  return lines
}

// Analyze a GitHub repository
async function analyzeRepository(owner: string, repo: string, systemDescription: string): Promise<string> {
  try {
    // 1) Fetch full tree
    let treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`)
    if (!treeRes.ok) {
      treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/master?recursive=1`)
      if (!treeRes.ok) {
        throw new Error('Could not fetch repository structure')
      }
    }
    const data: GitHubTreeResponse = await treeRes.json()

    // 2) Build in‑memory tree
    const root: TreeNode = { name: '.', isFile: false, children: {} }
    data.tree.forEach(item => {
      insertPath(root, item.path.split('/'))
    })

    // 3) Render ASCII tree and count
    const treeLines = renderTree(root)
    const fileCount = data.tree.filter(f => f.type === 'blob').length
    const dirCount  = data.tree.filter(f => f.type === 'tree').length
    const asciiTree = ['.', ...treeLines, ``, `${dirCount} directories, ${fileCount} files`].join('\n')

    // 4) Fetch root README.md if present
    let readmeContents = ''
    const readmeItem = data.tree.find(
      item => item.path === 'README.md'
    )
    if (readmeItem) {
      try {
        let rawRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`)
        if (!rawRes.ok) {
          rawRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`)
        }
        readmeContents = await rawRes.text()
      } catch {
        // ignore failures
      }
    }

    // 5) Build prompt
    const prompt = `
Repository structure:
${asciiTree}

${readmeContents ? `README.md contents:\n${readmeContents}` : '(no README.md found)'}

Based on this, describe what this repository does and generate a concise and detailed account of parts of what elements of the code 
that are relevant to deploying the code to AWS through terraform how the user specified in the requirements. Keept it as simple as possible.

User requirements: ${systemDescription}

NOTES: DO NOT GIVE ANY TERRAFORM CODE. KEEP YOUR RESPONSE AS SIMPLE AND SHORT AS POSSIBLE. IF A USER REFERENCES SPECIFIC RESOURCES IN THEIR
SYSTEM DESCRIPTION, ONLY INCLUDE MENTION OF THOSE RESOURCES. DO NOT DESCRIBE ANY CI/CD WORKFLOWS OR ANY OTHER IRRELEVANT DETAILS.

EXAMPLE: If a user is interesting in static hosting look for the presence of a build folder (whose contents should be uploaded to s3). If they want to run a Flask server, look for the presence of
a requirements.txt.
`.trim()

    // 6) Call Llama once
    const summaryRes = await fetchWithRetry(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'llama3-70b-8192',
          temperature: 0.1,
          max_tokens: 1500,
          messages: [
            {
              role: 'system',
              content: 'You are an AWS system architect. Given the repository overview below, produce a concise but detailed deployment plan for Terraform, including network rules and any GitHub Actions needed.',
            },
            { role: 'user', content: prompt },
          ],
        }),
      }
    )

    if (!summaryRes.ok) {
      throw new Error(`Llama summary call failed: ${summaryRes.status}`)
    }
    const summaryData = await summaryRes.json()
    return summaryData.choices[0].message.content
  } catch (err) {
    console.error('Error analyzing repository:', err)
    return ''
  }
}

// Helper function to generate a mermaid diagram string from the services
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
interface RequirementsWizardProps {
  onFinish: (description: string) => void;
}

export default function RequirementsWizard({ onFinish }: RequirementsWizardProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [systemInput, setSystemInput] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  // New state to keep repository analysis for later use
  const [repoAnalysis, setRepoAnalysis] = useState('');
  const [systemDesign, setSystemDesign] = useState<SystemDesign>({
    id: '1',
    name: '',
    requirements: [],
    services: []
  });

  const handleSystemDesignUpdate = (newDesign: SystemDesign) => {
    setSystemDesign(newDesign);
    generateMermaidDiagram(newDesign.services);
    console.log('Updated System Design:', newDesign);
  };

  const handleNext = async () => {
    // Step 0: Handle Repository & System Description
    if (activeStep === 0) {
      setLoading(true);
      try {
        // Get repository analysis if URL is provided
        let analysis = '';
        if (repoUrl) {
          const normalized = repoUrl
          .replace(/\/$/, '')          // remove any trailing slash
          .replace(/\.git$/, '');      // remove .git if present
          const repoUrlParts = normalized.replace('https://github.com/', '').split('/');
          const owner = repoUrlParts[0];
          const repo = repoUrlParts[1];
          analysis = await analyzeRepository(owner, repo, systemInput);
          console.log('Repository Analysis:', analysis);
          setRepoAnalysis(analysis);
        }

        // Generate architecture visualization with repo context if available
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
`You are an AWS architecture expert. Do not include any CICD unless specifically mentioned. You are designing a system that will be deployed using Terraform so there is no need for CICD or anything related to that.
Generate a mermaid diagram for AWS architecture with service explanations. 
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
                content: `${analysis ? `Based on this repository analysis:\n${analysis}\n\n` : ''}Create a mermaid diagram for an AWS architecture for: ${systemInput}. Include all necessary AWS services and their connections. Use simple names like EC2, S3, etc. Include a brief explanation for each service's specific role in this architecture.`
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
      setActiveStep((prevStep) => prevStep + 1);
    }
    // Final Step: On Finish, call Llama with chat history, mermaid diagram, and repository analysis.
    else if (activeStep === steps.length - 1) {
      setLoading(true);
      try {

        // Reconstruct mermaid diagram from current system design
        const mermaidDiagram = generateMermaidDiagram(systemDesign.services);

        console.log(mermaidDiagram.toString());
        
        // Build prompt that includes systemInput (as chat history), repo analysis, and the mermaid diagram
        const prompt = `
          Wanted System Description: ${systemInput}

          GitHub Repository URL: ${repoUrl}

          GitHub Repository Analysis:
          ${repoAnalysis}

          Mermaid Diagram Architecture:
          ${mermaidDiagram}


          Please provide a concise but detailed description for a Terraform script, in paragraph form, that automates the deployment of the described architecture. 
          Include network rules, actions to be taken with the GitHub repository, and anything else required in the Terraform script.

          NOTES: 
          DO NOT DISCUSS CI/CD OR GITHUB ACTIONS OR ANYTHING OF THAT SORT. THIS SHOULD ONLY DESCRIBE THE
          TERRAFORM WHICH DOES WHAT IS ASKED FROM BEGINNING TO END.

          ALSO, DON'T PROVIDE ANY DETAILS ON HOW TO EXECUTE THE TERRAFORM CODE JUST ON WHAT TYPE
          OF STUFF IT SHOULD INCLUDE.

          DO NOT DESCRIBE THE USE OF ANY TERRAFORM RESOURCES THAT ARE NOT IN THE MERMAID DIAGRAM.

          FINALLY IN YOUR DESCRIPTION INCLUDE THE GITHUB URL IF IT IS RELEVANT TO THE TERRAFORM CODE (EX. SOMETHING NEEDS TO BE DOWNLOADED FROM THE GITHUB)
        `;
        
        // Call Llama with the combined prompt
        const terraformResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            messages: [
              {
                role: 'system',
                content: 'You are an AWS architecture expert. Your task is to produce a concise yet detailed description for a Terraform script that automates the deployment of the specified architecture. Include network rules, GitHub actions, and any additional required steps.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            model: 'llama3-70b-8192',
            temperature: 0.1,
            max_tokens: 1500
          })
        });
        
        const terraformData = await terraformResponse.json();
        var terraformDescription = terraformData.choices[0].message.content;
        // Print the description to console
        console.log("Terraform Script Description:", terraformDescription);
        if (terraformDescription.startsWith('Here is a concise yet detailed description')) {
          const firstNewline = terraformDescription.indexOf('\n');
          if (firstNewline !== -1) {
            // Remove everything up to and including the first newline
            terraformDescription = terraformDescription.slice(firstNewline)
          }
        }
        
        onFinish(terraformDescription);
      } catch (error) {
        console.error('Error generating Terraform description:', error);
      } finally {
        setLoading(false);
      }
    }
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
        return <VisualizationPreview systemDesign={systemDesign} onUpdateSystemDesign={handleSystemDesignUpdate} />;
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
