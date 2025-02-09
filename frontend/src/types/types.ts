export interface AWSService {
  id: string;
  name: string;
  type: string;
  description: string;
  icon: string;
  connections: string[];
}

export interface SystemRequirement {
  id: string;
  type: 'functional' | 'non-functional';
  description: string;
  relatedServices: string[];
}

export interface SystemDesign {
  id: string;
  name: string;
  requirements: SystemRequirement[];
  services: AWSService[];
} 