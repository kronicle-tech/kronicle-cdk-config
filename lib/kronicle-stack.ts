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

    const kronicleVersion = "0.1.185";
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
      INTRO_MARKDOWN: `This is a live demo for [Kronicle](https://kronicle.tech). Kronicle is an open source system for
visualising and documenting a tech stack, including software and infrastructure.

Interesting pages in the demo:

1. [An interactive, dynamically generated dependencies diagram](/all-components/dependencies) that shows all the components in the demo tech stack and how they connect to each other.  Try hovering over items in the diagram and using the filters on the right hand side.
2. [A list of all the components in the demo tech stack](/all-components).  Try using the filters on the right hand side.
3. Kronicle fully supports OpenAPI specs.  Kronicle can download OpenAPI specs hosted on a service's endpoint (e.g. with Springdoc) and then [hostes a copy of those OpenAPI specs](/all-components/openapi-specs).  Click a link in the \`Link\` column on that page to view an individual OpenAPI spec rendered using Redoc.
4. [A list of all the components owned by a team](/teams/kronicle-project/components)
5. [Dependencies diagram for an individual component](/components/kronicle-service/dependencies).  Use the radius dropdown on the right hand side to see more of the tech stack that surrounds the component.
6. [A component's page which shows the "key software" used by the component and other important information](/components/kronicle-service).  Kronicle automatically scans Gradle build scripts (npm support coming soon) to find the key software used by the component.
7. [All the tech debt for the tech stack](/all-components/tech-debts)
8. [All the cross functional requirements (NFRs) for a team](/teams/kronicle-project/cross-functional-requirements)
9. [Response times for any components using Zipkin for distributed tracing](/components/kronicle-service/response-times)`,
    };
    const kronicleServiceEnvironment = {
      PLUGINS_GITHUB_ENABLED: "true",
      PLUGINS_GITHUB_ORGANIZATIONS_0_ACCOUNT_NAME: "kronicle-tech",
      // PLUGINS_GITHUB_ORGANIZATIONS_1_ACCOUNT_NAME: "kronicle-computers",
      PLUGINS_AWS_ENABLED: "true",
      PLUGINS_AWS_PROFILES_0_ENVIRONMENT_ID: "production",
      PLUGINS_AWS_PROFILES_0_REGIONS_0: "us-west-2",
      PLUGINS_SONARQUBE_ENABLED: "true",
      PLUGINS_SONARQUBE_BASE_URL: "https://sonarcloud.io",
      PLUGINS_SONARQUBE_ORGANIZATIONS_0: "kronicle-tech",
      REPO_FINDERS_IGNORED_REPOS_0_URL:
        "https://github.com/kronicle-tech/kronicle-metadata-repo-template.git",
      REPO_FINDERS_IGNORED_REPOS_1_URL:
        "https://github.com/kronicle-tech/kronicle-metadata-codebase-template.git",
      REPO_FINDERS_IGNORED_REPOS_2_URL:
        "https://github.com/kronicle-tech/kronicle-argocd-config.git",
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
      // PLUGINS_GITHUB_ORGANIZATIONS_1_ACCESS_TOKEN_USERNAME:
      //   ecs.Secret.fromSecretsManager(
      //     kronicleServiceConfigSecret,
      //     "kronicle-computers-github-username"
      //   ),
      // PLUGINS_GITHUB_ORGANIZATIONS_1_ACCESS_TOKEN_VALUE:
      //   ecs.Secret.fromSecretsManager(
      //     kronicleServiceConfigSecret,
      //     "kronicle-computers-github-access-token"
      //   ),
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
      cpu: 512,
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
        interval: cdk.Duration.seconds(60),
        retries: 5,
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
      cpu: 1_024,
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
        interval: cdk.Duration.seconds(60),
        retries: 5,
        startPeriod: cdk.Duration.seconds(15),
      },
      environment,
      secrets,
    });
  }

  private createVpc() {
    return new ec2.Vpc(this, "KronicleVpc", {
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
      cpu: 2_048,
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
