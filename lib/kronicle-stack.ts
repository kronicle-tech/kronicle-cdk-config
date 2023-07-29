import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import {
  AutoScalingGroup,
  SpotAllocationStrategy,
  UpdatePolicy,
} from "aws-cdk-lib/aws-autoscaling";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ecs from "aws-cdk-lib/aws-ecs";
import {
  AsgCapacityProvider,
  MachineImageType,
  NetworkMode,
} from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import {
  InstanceArchitecture,
  InstanceType,
  LaunchTemplate,
  SubnetType,
} from "aws-cdk-lib/aws-ec2";
import * as elb from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { ApplicationProtocol } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sm from "aws-cdk-lib/aws-secretsmanager";

export class KronicleStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const kronicleVersion = "0.1.419";
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
      "Kronicle",
    );

    let kronicleAppEnvironment = {
      SERVER_SIDE_SERVICE_BASE_URL: "http://kronicle-service:8090",
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
      PLUGINS_KUBERNETES_CLUSTERS_0_API_RESOURCES_WITH_SUPPORTED_METADATA_ONLY:
        "true",
      PLUGINS_SONARQUBE_ENABLED: "true",
      PLUGINS_SONARQUBE_BASE_URL: "https://sonarcloud.io",
      PLUGINS_SONARQUBE_ORGANIZATIONS_0: "kronicle-tech",
      REPO_FINDERS_IGNORED_REPOS_0_URL:
        "https://github.com/kronicle-tech/kronicle-metadata-repo-template.git",
      REPO_FINDERS_IGNORED_REPOS_1_URL:
        "https://github.com/kronicle-tech/kronicle-metadata-codebase-template.git",
      REPO_FINDERS_IGNORED_REPOS_2_URL:
        "https://github.com/kronicle-tech/kronicle-argocd-config.git",
      LOGGING_LEVEL_TECH_KRONICLE: "INFO",
    };
    const kronicleServiceSecrets = {
      PLUGINS_GITHUB_ORGANIZATIONS_0_ACCESS_TOKEN_USERNAME:
        ecs.Secret.fromSecretsManager(
          kronicleServiceConfigSecret,
          "kronicle-tech-github-username",
        ),
      PLUGINS_GITHUB_ORGANIZATIONS_0_ACCESS_TOKEN_VALUE:
        ecs.Secret.fromSecretsManager(
          kronicleServiceConfigSecret,
          "kronicle-tech-github-access-token",
        ),
      PLUGINS_KUBERNETES_CLUSTERS_0_KUBE_CONFIG: ecs.Secret.fromSecretsManager(
        kronicleServiceConfigSecret,
        "example-eks-kube-config",
      ),
    };

    const vpc = this.createVpc();
    const cluster = this.createEcsCluster(vpc);
    const autoScalingGroup = this.createAutoScalingGroup(vpc);
    const capacityProvider = this.createCapacityProvider(
      cluster,
      autoScalingGroup,
    );
    const certificate = this.createCertificate(domainName);
    const taskDefinition = this.createTaskDefinition();
    const kronicleAppContainer = this.createKronicleAppContainer(
      taskDefinition,
      kronicleVersion,
      kronicleAppEnvironment,
    );
    cdk.Tags.of(kronicleAppContainer).add("component", "kronicle-app");
    const kronicleServiceContainer = this.createKronicleServiceContainer(
      taskDefinition,
      kronicleVersion,
      kronicleServiceEnvironment,
      kronicleServiceSecrets,
    );
    cdk.Tags.of(kronicleServiceContainer).add("component", "kronicle-service");
    kronicleAppContainer.addLink(kronicleServiceContainer, "kronicle-service");
    this.addPolicyStatementsToTaskRole(taskDefinition, [
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
        actions: ["eks:AccessKubernetesApi"],
        resources: ["*"],
      },
    ]);
    this.createApplicationLoadBalancedService(
      cluster,
      taskDefinition,
      autoScalingGroup,
      capacityProvider,
      certificate,
    );
  }

  private createKronicleAppContainer(
    taskDefinition: ecs.FargateTaskDefinition,
    kronicleVersion: string,
    environment: {
      [key: string]: string;
    },
  ) {
    return taskDefinition.addContainer("KronicleApp", {
      containerName: "KronicleApp",
      image: ecs.ContainerImage.fromRegistry(
        `public.ecr.aws/kronicle-tech/kronicle-app:${kronicleVersion}`,
      ),
      cpu: 128,
      memoryReservationMiB: 512,
      essential: true,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "KronicleApp",
      }),
      portMappings: [
        {
          name: "app",
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
    },
  ) {
    return taskDefinition.addContainer("KronicleService", {
      containerName: "KronicleService",
      image: ecs.ContainerImage.fromRegistry(
        `public.ecr.aws/kronicle-tech/kronicle-service:${kronicleVersion}`,
      ),
      cpu: 384,
      memoryReservationMiB: 1_024,
      essential: true,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "KronicleService",
      }),
      portMappings: [
        {
          name: "service",
          containerPort: 8090,
        },
        {
          name: "service-management",
          containerPort: 8091,
        },
      ],
      healthCheck: {
        command: ["CMD", "java", "-jar", "health-check.jar"],
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
      vpcName: "Kronicle",
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

    // // Only needed by CloudWatch Synthetics Canary
    // vpc.addGatewayEndpoint('S3VpcEndpoint', {
    //   service: ec2.GatewayVpcEndpointAwsService.S3
    // })

    // // Only needed by CloudWatch Synthetics Canary
    // vpc.addInterfaceEndpoint('CloudWatchVpcEndpoint', {
    //   service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH
    // })

    return vpc;
  }

  private createEcsCluster(vpc: ec2.Vpc) {
    return new ecs.Cluster(this, "KronicleEcsCluster", {
      clusterName: "Kronicle",
      vpc,
    });
  }

  private createAutoScalingGroup(vpc: ec2.Vpc) {
    const spotInstanceTypes = [
      "t3a.medium",
      "t3.medium",
      "t2.medium",
      "t3a.large",
      "t3.large",
      "m5a.large",
      "m6a.large",
      "t2.large",
      "m6i.large",
      "m5.large",
      "m4.large",
    ];
    const nodeSecurityGroup = new ec2.SecurityGroup(
      this,
      "KronicleNodeSecurityGroup",
      {
        securityGroupName: "KronicleNodeSecurityGroup",
        vpc,
        allowAllOutbound: true,
      },
    );
    return new AutoScalingGroup(this, "KronicleAutoScalingGroup", {
      vpc,
      vpcSubnets: {
        subnetType: SubnetType.PUBLIC,
      },
      allowAllOutbound: true,
      maxCapacity: 1,
      minCapacity: 1,
      mixedInstancesPolicy: {
        instancesDistribution: {
          onDemandPercentageAboveBaseCapacity: 0,
          spotAllocationStrategy:
            SpotAllocationStrategy.PRICE_CAPACITY_OPTIMIZED,
          // // t4g.small currently costs 0.0376 for on-demand
          spotMaxPrice: "0.0376",
        },
        launchTemplate: new LaunchTemplate(this, "KronicleLaunchTemplate", {
          launchTemplateName: "KronicleLaunchTemplate",
          securityGroup: nodeSecurityGroup,
          instanceType: new InstanceType("t3a.medium"),
          machineImage: new ecs.BottleRocketImage({
            architecture: InstanceArchitecture.X86_64,
          }),
          userData: ec2.UserData.forLinux(),
          role: new iam.Role(this, "KronicleNodeRole", {
            assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
          }),
        }),
        launchTemplateOverrides: spotInstanceTypes.map((instanceType) => ({
          instanceType: new InstanceType(instanceType),
        })),
      },
      updatePolicy: UpdatePolicy.rollingUpdate({}),
    });
  }

  private createCapacityProvider(
    cluster: ecs.Cluster,
    autoScalingGroup: autoscaling.AutoScalingGroup,
  ) {
    const capacityProvider = new AsgCapacityProvider(
      this,
      "KronicleCapacityProvider",
      {
        capacityProviderName: "KronicleCapacityProvider",
        autoScalingGroup,
        canContainersAccessInstanceRole: true,
        enableManagedScaling: true,
        enableManagedTerminationProtection: false,
        machineImageType: MachineImageType.BOTTLEROCKET,
        spotInstanceDraining: true,
      },
    );
    cluster.addAsgCapacityProvider(capacityProvider);
    return capacityProvider;
  }

  private createCertificate(domainName: string) {
    return new acm.Certificate(this, "KronicleCertificate", {
      domainName,
      validation: acm.CertificateValidation.fromDns(),
    });
  }

  private createTaskDefinition() {
    return new ecs.Ec2TaskDefinition(this, "KronicleTaskDefinition", {
      family: "KronicleEc2",
      networkMode: NetworkMode.BRIDGE,
    });
  }

  private createApplicationLoadBalancedService(
    cluster: ecs.Cluster,
    taskDefinition: ecs.Ec2TaskDefinition,
    autoScalingGroup: autoscaling.AutoScalingGroup,
    capacityProvider: AsgCapacityProvider,
    certificate: acm.Certificate,
  ) {
    const service = new ecsPatterns.ApplicationLoadBalancedEc2Service(
      this,
      "KronicleEcsService",
      {
        serviceName: "KronicleEc2",
        loadBalancerName: "KronicleEc2",
        cluster,
        taskDefinition,
        recordType: ecsPatterns.ApplicationLoadBalancedServiceRecordType.CNAME,
        certificate,
        sslPolicy: elb.SslPolicy.RECOMMENDED,
        redirectHTTP: true,
        publicLoadBalancer: true,
        openListener: true,
        circuitBreaker: {
          //rollback: true,
          rollback: false,
        },
        capacityProviderStrategies: [
          {
            capacityProvider: capacityProvider.capacityProviderName,
            weight: 1,
          },
        ],
      },
    );
    // See https://github.com/aws/aws-cdk/issues/16260
    autoScalingGroup.connections.allowFrom(
      service.loadBalancer,
      ec2.Port.tcpRange(32768, 65535),
      "Allow from load balancer",
    );
    service.targetGroup.configureHealthCheck({
      path: "/health",
    });
    const targetGroupId = "KronicleTargetGroup";
    service.listener.addTargets(targetGroupId, {
      targetGroupName: targetGroupId,
      protocol: ApplicationProtocol.HTTPS,
      targets: [
        service.service.loadBalancerTarget({
          containerName: "KronicleApp",
          containerPort: 3000,
        }),
      ],
    });
  }

  private addPolicyStatementsToTaskRole(
    taskDefinition: ecs.TaskDefinition,
    policyStatements: ReadonlyArray<iam.PolicyStatementProps>,
  ) {
    policyStatements.forEach((policyStatement) =>
      taskDefinition.addToTaskRolePolicy(
        new iam.PolicyStatement(policyStatement),
      ),
    );
  }
}
