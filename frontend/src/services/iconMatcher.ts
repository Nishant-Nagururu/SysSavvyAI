import { SystemRequirement, AWSService } from '../types/types';

const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY;

const AVAILABLE_ICONS = [
  'EC2', 'S3', 'RDS', 'DynamoDB', 'Lambda', 'APIGateway', 'CloudFront', 'Cognito',
  'SES', 'ES', 'WAF', 'CloudWatch', 'ECS', 'EFS', 'ElasticBeanstalk', 'IAM',
  'Kinesis', 'Route53', 'SNS', 'SQS', 'StepFunctions', 'VPC', 'CloudFormation',
  'CodeBuild', 'CodeCommit', 'CodeDeploy', 'CodePipeline', 'ElasticCache'
  // Add more available icons as needed
];

export async function getIconForService(serviceName: string): Promise<string> {
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
            content: `You are an AWS expert. From the following list of available AWS icons, select the most appropriate one for the given AWS service. Respond ONLY with the icon name, nothing else:
            Available icons: ${AVAILABLE_ICONS.join(', ')}`
          },
          {
            role: 'user',
            content: `Select the most appropriate icon for this AWS service: ${serviceName}`
          }
        ],
        model: 'llama3-70b-8192',
        temperature: 0.1,
        max_tokens: 50
      })
    });

    const data = await response.json();
    const iconName = data.choices[0].message.content.trim();
    
    // Validate that the returned icon exists in our list
    if (AVAILABLE_ICONS.includes(iconName)) {
      return iconName;
    }
    
    // If not found, try to match based on service name
    const serviceParts = serviceName.split(' ');
    const matchedIcon = AVAILABLE_ICONS.find(icon => 
      serviceParts.some(part => icon.toLowerCase().includes(part.toLowerCase()))
    );
    
    return matchedIcon || 'EC2'; // Default to EC2 if no match found
  } catch (error) {
    console.error('Error getting icon for service:', error);
    return 'EC2'; // Default fallback
  }
} 