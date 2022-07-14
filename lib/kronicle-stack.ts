import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elb from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sm from "aws-cdk-lib/aws-secretsmanager";

export class KronicleStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const kronicleVersion = "0.1.353";
    const domainName = "demo.kronicle.tech";

    // If you want to connect Kronicle to a Git host like GitHub or GitLab, you will probably need to configure Kronicle
    // with access tokens.  These access tokens can be placed in a "secret" in AWS Secrets Manager.  Create a secret
    // in AWS Secrets Manager named "kronicle" with a value like this:
    //
    // {
    //   "github-username": "some-github-username",
    //   "github-access-token": "some-github-access-token"
    // }
    //
    // Note: The secret needs to be created before using CDK to deploy this CDK project
    const kronicleServiceConfigSecret = sm.Secret.fromSecretNameV2(
      this,
      "KronicleServiceConfigSecret",
      "kronicle"
    );

    let kronicleAppEnvironment = {
      SERVER_SIDE_SERVICE_BASE_URL: "http://localhost:8090",
      ANALYTICS_PLAUSIBLE_ENABLED: "true",
      ANALYTICS_PLAUSIBLE_DATA_DOMAIN: "demo.kronicle.tech",
      INTRO_TITLE: "Kronicle Live Demo",
      INTRO_MARKDOWN: `This is a live demo of [Kronicle](https://kronicle.tech). Kronicle is an open source platform 
for visualising and documenting a tech stack, including software and infrastructure.  The demo is a real instance of 
Kronicle, containing real data.  

Use the menu above to view the different parts of Kronicle.  `,
      MESSAGE_MARKDOWN: `<span class="text-dark">See <a href="https://kronicle.tech" class="text-dark">Kronicle's website</a> for more information about Kronicle</span>`,
      MESSAGE_VARIANT: "light",
    };
    const kronicleServiceEnvironment = {
      PLUGINS_GITHUB_ENABLED: "true",
      PLUGINS_GITHUB_ORGANIZATIONS_0_ACCOUNT_NAME: "kronicle-tech",
      PLUGINS_AWS_ENABLED: "true",
      PLUGINS_AWS_API_RESOURCES_WITH_SUPPORTED_METADATA_ONLY: "true",
      PLUGINS_AWS_COPY_RESOURCE_TAGS_TO_COMPONENTS: "false",
      PLUGINS_AWS_CREATE_DEPENDENCIES_FOR_RESOURCES: "true",
      PLUGINS_AWS_PROFILES_0_ENVIRONMENT_ID: "production",
      PLUGINS_AWS_PROFILES_0_REGIONS_0: "us-west-2",
      PLUGINS_AWS_LOG_SUMMARIES_ONE_HOUR_SUMMARIES: "false",
      PLUGINS_AWS_LOG_SUMMARIES_TWENTY_FOUR_HOUR_SUMMARIES: "false",
      PLUGINS_KUBERNETES_ENABLED: "true",
      PLUGINS_KUBERNETES_CLUSTERS_0_ENVIRONMENT_ID: "production",
      PLUGINS_KUBERNETES_CLUSTERS_0_API_RESOURCES_WITH_SUPPORTED_METADATA_ONLY: "true",
      PLUGINS_SONARQUBE_ENABLED: "true",
      PLUGINS_SONARQUBE_BASE_URL: "https://sonarcloud.io",
      PLUGINS_SONARQUBE_ORGANIZATIONS_0: "kronicle-tech",
      REPO_FINDERS_IGNORED_REPOS_0_URL:
        "https://github.com/kronicle-tech/kronicle-metadata-repo-template.git",
      REPO_FINDERS_IGNORED_REPOS_1_URL:
        "https://github.com/kronicle-tech/kronicle-metadata-codebase-template.git",
      REPO_FINDERS_IGNORED_REPOS_2_URL:
        "https://github.com/kronicle-tech/kronicle-argocd-config.git",
      LOGGING_LEVEL_TECH_KRONICLE: 'INFO',
    };
    const kronicleServiceSecrets = {
      PLUGINS_GITHUB_ORGANIZATIONS_0_ACCESS_TOKEN_USERNAME:
        ecs.Secret.fromSecretsManager(
          kronicleServiceConfigSecret,
          "kronicle-tech-github-username"
        ),
      PLUGINS_GITHUB_ORGANIZATIONS_0_ACCESS_TOKEN_VALUE:
        ecs.Secret.fromSecretsManager(
          kronicleServiceConfigSecret,
          "kronicle-tech-github-access-token"
        ),
      PLUGINS_KUBERNETES_CLUSTERS_0_KUBE_CONFIG:
        ecs.Secret.fromSecretsManager(
          kronicleServiceConfigSecret,
          "example-eks-kube-config"
        ),
    };

    const vpc = this.createVpc();
    const cluster = this.createEcsCluster(vpc);
    const certificate = this.createCertificate(domainName);
    const taskDefinition = this.createFargateTaskDefinition();
    const kronicleAppContainer = this.createKronicleAppContainer(
      taskDefinition,
      kronicleVersion,
      kronicleAppEnvironment
    );
    cdk.Tags.of(kronicleAppContainer).add("component", "kronicle-app");
    const kronicleServiceContainer = this.createKronicleServiceContainer(
      taskDefinition,
      kronicleVersion,
      kronicleServiceEnvironment,
      kronicleServiceSecrets
    );
    cdk.Tags.of(kronicleServiceContainer).add("component", "kronicle-service");
    this.addPolicyStatementsToFargateTaskRole(taskDefinition, [
      {
        effect: iam.Effect.ALLOW,
        actions: ["xray:GetServiceGraph"],
        resources: ["*"],
      },
      {
        effect: iam.Effect.ALLOW,
        actions: ["tag:GetResources"],
        resources: ["*"],
      },
      {
        effect: iam.Effect.ALLOW,
        actions: ["logs:StartQuery", "logs:GetQueryResults"],
        resources: ["*"],
      },
      {
        effect: iam.Effect.ALLOW,
        actions: ["synthetics:DescribeCanariesLastRun"],
        resources: ["*"],
      },
      {
        effect: iam.Effect.ALLOW,
        actions: ['eks:AccessKubernetesApi',],
        resources: ['*'],
      }
    ]);
    this.createApplicationLoadBalancedFargateService(
      cluster,
      taskDefinition,
      certificate
    );
  }

  private createKronicleAppContainer(
    taskDefinition: ecs.FargateTaskDefinition,
    kronicleVersion: string,
    environment: {
      [key: string]: string;
    }
  ) {
    return taskDefinition.addContainer("KronicleApp", {
      containerName: "kronicle-app",
      image: ecs.ContainerImage.fromRegistry(
        `public.ecr.aws/kronicle-tech/kronicle-app:${kronicleVersion}`
      ),
      cpu: 256,
      memoryReservationMiB: 1_024,
      essential: true,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "kronicle-app",
      }),
      portMappings: [
        {
          containerPort: 3000,
        },
      ],
      healthCheck: {
        command: ["CMD", "/nodejs/bin/node", "bin/healthcheck.js"],
        timeout: cdk.Duration.seconds(15),
        interval: cdk.Duration.seconds(30),
        retries: 10,
        startPeriod: cdk.Duration.seconds(15),
      },
      environment,
    });
  }

  private createKronicleServiceContainer(
    taskDefinition: ecs.FargateTaskDefinition,
    kronicleVersion: string,
    environment: {
      [key: string]: string;
    },
    secrets: {
      [key: string]: ecs.Secret;
    }
  ) {
    return taskDefinition.addContainer("KronicleService", {
      containerName: "kronicle-service",
      image: ecs.ContainerImage.fromRegistry(
        `public.ecr.aws/kronicle-tech/kronicle-service:${kronicleVersion}`
      ),
      cpu: 768,
      memoryReservationMiB: 2_024,
      essential: true,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "kronicle-service",
      }),
      portMappings: [
        {
          containerPort: 8090,
        },
        {
          containerPort: 8091,
        },
      ],
      healthCheck: {
        command: ["CMD", "java", "Healthcheck.java"],
        timeout: cdk.Duration.seconds(15),
        interval: cdk.Duration.seconds(30),
        retries: 10,
        startPeriod: cdk.Duration.seconds(15),
      },
      environment,
      secrets,
    });
  }

  private createVpc() {
    const vpc = new ec2.Vpc(this, "KronicleVpc", {
      vpcName: "kronicle",
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    // Only needed by CloudWatch Synthetics Canary
    vpc.addGatewayEndpoint('S3VpcEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3
    })

    // Only needed by CloudWatch Synthetics Canary
    vpc.addInterfaceEndpoint('CloudWatchVpcEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH
    })

    return vpc;
  }

  private createEcsCluster(vpc: ec2.Vpc) {
    return new ecs.Cluster(this, "KronicleEcsCluster", {
      clusterName: "kronicle",
      vpc,
    });
  }

  private createCertificate(domainName: string) {
    return new acm.Certificate(this, "KronicleCertificate", {
      domainName,
      validation: acm.CertificateValidation.fromDns(),
    });
  }

  private createFargateTaskDefinition() {
    return new ecs.FargateTaskDefinition(this, "KronicleTaskDefinition", {
      family: "kronicle",
      cpu: 1_024,
      memoryLimitMiB: 4_096,
    });
  }

  private createApplicationLoadBalancedFargateService(
    cluster: ecs.Cluster,
    taskDefinition: ecs.FargateTaskDefinition,
    certificate: acm.Certificate
  ) {
    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      "KronicleEcsService",
      {
        serviceName: "kronicle",
        loadBalancerName: "kronicle",
        cluster,
        taskDefinition,
        assignPublicIp: true,
        recordType: ecsPatterns.ApplicationLoadBalancedServiceRecordType.CNAME,
        certificate,
        sslPolicy: elb.SslPolicy.RECOMMENDED,
        redirectHTTP: true,
        circuitBreaker: {
          rollback: true,
        },
      }
    );
    service.targetGroup.configureHealthCheck({
      path: "/health",
    });
  }

  private addPolicyStatementsToFargateTaskRole(
    taskDefinition: ecs.FargateTaskDefinition,
    policyStatements: ReadonlyArray<iam.PolicyStatementProps>
  ) {
    policyStatements.forEach((policyStatement) =>
      taskDefinition.addToTaskRolePolicy(
        new iam.PolicyStatement(policyStatement)
      )
    );
  }
}
