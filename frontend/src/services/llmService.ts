import { SystemRequirement, AWSService } from '../types/types';

const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY;

export async function getServiceRecommendations(applicationType: string, requirements: SystemRequirement[]) {
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
            content: `You are an AWS architecture expert. Respond ONLY with a JSON object in the exact format shown below, with no additional text or explanation:
            {
              "recommendations": [
                {
                  "service": "Service Name (exactly as shown in AWS, e.g., 'Amazon EC2')",
                  "pros": ["Only list pros specifically relevant to this use case"],
                  "cons": ["Only list cons specifically relevant to this use case"]
                }
              ]
            }`
          },
          {
            role: 'user',
            content: `Given this application type: "${applicationType}" and these requirements: ${JSON.stringify(requirements.map(r => r.description))}, provide AWS service recommendations in the specified JSON format. Focus only on services that directly address the requirements.`
          }
        ],
        model: 'llama3-70b-8192',
        temperature: 0.3, // Reduced temperature for more consistent output
        max_tokens: 1000,
        response_format: { type: "json_object" } // Force JSON response
      })
    });

    const data = await response.json();
    
    if (!data.choices?.[0]?.message?.content) {
      throw new Error('Invalid API response format');
    }

    const content = data.choices[0].message.content;
    
    try {
      // Try to parse the raw content first
      const parsed = JSON.parse(content);
      return parsed.recommendations || [];
    } catch (parseError) {
      // If direct parsing fails, try to clean the content
      const cleanedContent = content
        .replace(/```json\s*|\s*```/g, '') // Remove code blocks
        .replace(/^[^{]*/, '') // Remove any text before the first {
        .replace(/[^}]*$/, '') // Remove any text after the last }
        .trim();
      
      try {
        const parsed = JSON.parse(cleanedContent);
        return parsed.recommendations || [];
      } catch (secondParseError) {
        console.error('Failed to parse cleaned content:', cleanedContent);
        throw new Error('Failed to parse LLM response as JSON');
      }
    }
  } catch (error) {
    console.error('Error getting recommendations:', error);
    // Return a minimal set of recommendations based on requirements
    return requirements.map(req => {
      const defaultServices = {
        'User Authentication': 'Amazon Cognito',
        'Data Storage': 'Amazon S3',
        'API Integration': 'Amazon API Gateway',
        'Real-time Processing': 'AWS Lambda',
        'File Upload/Download': 'Amazon S3',
        'Email Notifications': 'Amazon SES',
        'Search Functionality': 'Amazon OpenSearch',
        'High Availability': 'Amazon EC2 Auto Scaling',
        'Scalability': 'Amazon EC2',
        'Security': 'AWS WAF',
        'Performance': 'Amazon CloudFront',
        'Cost Optimization': 'AWS Cost Explorer',
        'Disaster Recovery': 'Amazon S3',
        'Compliance': 'AWS Config'
      };

      const service = defaultServices[req.description] || 'Amazon EC2';
      return {
        service,
        pros: [`Addresses ${req.description.toLowerCase()} requirement`],
        cons: ['Fallback recommendation - LLM service unavailable']
      };
    });
  }
} 