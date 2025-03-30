declare module 'react-aws-icons/dist/aws/logo/*' {
  import { ComponentType } from 'react';

  interface IconProps {
    size?: number;
    className?: string;
  }

  const Icon: ComponentType<IconProps>;
  export default Icon;
}

// Individual declarations for each AWS icon
declare module 'react-aws-icons/dist/aws/logo/EC2' {
  import { ComponentType } from 'react';
  const EC2Icon: ComponentType<{ size?: number; className?: string }>;
  export default EC2Icon;
}

declare module 'react-aws-icons/dist/aws/logo/S3' {
  import { ComponentType } from 'react';
  const S3Icon: ComponentType<{ size?: number; className?: string }>;
  export default S3Icon;
}

declare module 'react-aws-icons/dist/aws/logo/RDS' {
  import { ComponentType } from 'react';
  const RDSIcon: ComponentType<{ size?: number; className?: string }>;
  export default RDSIcon;
}

declare module 'react-aws-icons/dist/aws/logo/DynamoDB' {
  import { ComponentType } from 'react';
  const DynamoDBIcon: ComponentType<{ size?: number; className?: string }>;
  export default DynamoDBIcon;
}

declare module 'react-aws-icons/dist/aws/logo/Lambda' {
  import { ComponentType } from 'react';
  const LambdaIcon: ComponentType<{ size?: number; className?: string }>;
  export default LambdaIcon;
}

declare module 'react-aws-icons/dist/aws/logo/APIGateway' {
  import { ComponentType } from 'react';
  const APIGatewayIcon: ComponentType<{ size?: number; className?: string }>;
  export default APIGatewayIcon;
}

declare module 'react-aws-icons/dist/aws/logo/CloudFront' {
  import { ComponentType } from 'react';
  const CloudFrontIcon: ComponentType<{ size?: number; className?: string }>;
  export default CloudFrontIcon;
}

declare module 'react-aws-icons/dist/aws/logo/Cognito' {
  import { ComponentType } from 'react';
  const CognitoIcon: ComponentType<{ size?: number; className?: string }>;
  export default CognitoIcon;
}

declare module 'react-aws-icons/dist/aws/logo/SES' {
  import { ComponentType } from 'react';
  const SESIcon: ComponentType<{ size?: number; className?: string }>;
  export default SESIcon;
}

declare module 'react-aws-icons/dist/aws/logo/ES' {
  import { ComponentType } from 'react';
  const ElasticSearchIcon: ComponentType<{ size?: number; className?: string }>;
  export default ElasticSearchIcon;
}

declare module 'react-aws-icons/dist/aws/logo/WAF' {
  import { ComponentType } from 'react';
  const WAFIcon: ComponentType<{ size?: number; className?: string }>;
  export default WAFIcon;
} 