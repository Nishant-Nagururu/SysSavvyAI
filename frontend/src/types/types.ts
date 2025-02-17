export interface SystemRequirement {
  id: string;
  description: string;
  type: 'functional' | 'nonFunctional';
}

export interface AWSService {
  id: string;
  name: string;
  type: string;
  description: string;
  icon: string;
  connections: string[];
}

export interface SystemDesign {
  id: string;
  name: string;
  requirements: SystemRequirement[];
  services: AWSService[];
} 