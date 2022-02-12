import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import { ApplicationLoadBalancedServiceRecordType } from "aws-cdk-lib/aws-ecs-patterns";
import * as elb from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as sm from "aws-cdk-lib/aws-secretsmanager";
import { Duration } from "aws-cdk-lib";

export class KronicleStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "KronicleVpc", {
      vpcName: "kronicle",
      maxAzs: 2,
    });
    const cluster = new ecs.Cluster(this, "KronicleEcsCluster", {
      clusterName: "kronicle",
      vpc,
    });
    const domainName = "demo.kronicle.tech";
    const certificate = new acm.Certificate(this, "KronicleCertificate", {
      domainName,
      validation: acm.CertificateValidation.fromDns(),
    });
    const kronicleServiceConfigSecret = new sm.Secret(
      this,
      "KronicleServiceConfigSecret",
      {
        secretName: "kronicle",
      }
    );
    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "KronicleTaskDefinition",
      {
        family: "kronicle",
        cpu: 2_048,
        memoryLimitMiB: 4_096,
      }
    );
    taskDefinition.addContainer("KronicleApp", {
      containerName: "kronicle-app",
      image: ecs.ContainerImage.fromRegistry(
        "public.ecr.aws/v1k6a4j2/kronicle-app:0.1.143"
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
        timeout: Duration.seconds(15),
        interval: Duration.seconds(60),
        retries: 5,
        startPeriod: Duration.seconds(15),
      },
      environment: {
        SERVER_SIDE_SERVICE_BASE_URL: "http://localhost:8090",
        ANALYTICS_PLAUSIBLE_ENABLED: "true",
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
      },
    });
    taskDefinition.addContainer("KronicleService", {
      containerName: "kronicle-service",
      image: ecs.ContainerImage.fromRegistry(
        "public.ecr.aws/v1k6a4j2/kronicle-service:0.1.143"
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
        timeout: Duration.seconds(15),
        interval: Duration.seconds(60),
        retries: 5,
        startPeriod: Duration.seconds(15),
      },
      environment: {
        OPENAPI_SPEC_CLEAR_EXISTING_SERVERS: "true",
        OPENAPI_SPEC_SERVERS_0_DESCRIPTION:
          "The demo instance of Kronicle Service",
        REPO_FINDERS_IGNORED_REPOS_0_URL:
          "https://github.com/kronicle-tech/kronicle-metadata-repo-template.git",
        REPO_FINDERS_IGNORED_REPOS_1_URL:
          "https://github.com/kronicle-tech/kronicle-metadata-codebase-template.git",
        REPO_FINDERS_GITHUB_ORGANIZATIONS_0_ACCOUNT_NAME: "kronicle-tech",
        REPO_FINDERS_GITHUB_ORGANIZATIONS_1_ACCOUNT_NAME: "kronicle-computers",
        KEY_SOFTWARE_RULES_0_SOFTWARE_NAME_PATTERN: "^gradle-wrapper$",
        KEY_SOFTWARE_RULES_0_NAME: "Gradle",
        KEY_SOFTWARE_RULES_1_SOFTWARE_NAME_PATTERN:
          "^org.springframework.boot:",
        KEY_SOFTWARE_RULES_1_NAME: "Spring Boot",
        KEY_SOFTWARE_RULES_2_SOFTWARE_NAME_PATTERN: "^com.google.guava:guava$",
        KEY_SOFTWARE_RULES_2_NAME: "Guava",
        KEY_SOFTWARE_RULES_3_SOFTWARE_NAME_PATTERN: "^io.zipkin.brave:brave$",
        KEY_SOFTWARE_RULES_3_NAME: "Zipkin Brave",
        KEY_SOFTWARE_RULES_4_SOFTWARE_NAME_PATTERN:
          "^io.dropwizard:dropwizard-core$",
        KEY_SOFTWARE_RULES_4_NAME: "Dropwizard",
        KEY_SOFTWARE_RULES_5_SOFTWARE_NAME_PATTERN:
          "^com.fasterxml.jackson.core:",
        KEY_SOFTWARE_RULES_5_NAME: "Jackson",
        KEY_SOFTWARE_RULES_6_SOFTWARE_NAME_PATTERN:
          "^org.springframework.cloud:spring-cloud-dependencies$",
        KEY_SOFTWARE_RULES_6_NAME: "Spring Cloud",
        KEY_SOFTWARE_RULES_7_SOFTWARE_NAME_PATTERN:
          "^org.projectlombok:lombok$",
        KEY_SOFTWARE_RULES_7_NAME: "Lombok",
        KEY_SOFTWARE_RULES_8_SOFTWARE_NAME_PATTERN:
          "^org.jetbrains.kotlin:kotlin-bom$",
        KEY_SOFTWARE_RULES_8_NAME: "Kotlin",
        KEY_SOFTWARE_RULES_9_SOFTWARE_NAME_PATTERN:
          "^io.micronaut:micronaut-bom$",
        KEY_SOFTWARE_RULES_9_NAME: "Micronaut",
        KEY_SOFTWARE_RULES_10_SOFTWARE_NAME_PATTERN: "^aws-cdk$",
        KEY_SOFTWARE_RULES_10_NAME: "AWS CDK",
        KEY_SOFTWARE_RULES_11_SOFTWARE_NAME_PATTERN: "^aws-sdk$",
        KEY_SOFTWARE_RULES_11_NAME: "AWS SDK",
        KEY_SOFTWARE_RULES_12_SOFTWARE_NAME_PATTERN: "^vue$",
        KEY_SOFTWARE_RULES_12_NAME: "Vue",
        KEY_SOFTWARE_RULES_13_SOFTWARE_NAME_PATTERN: "^nuxt$",
        KEY_SOFTWARE_RULES_13_NAME: "Nuxt",
        KEY_SOFTWARE_RULES_14_SOFTWARE_NAME_PATTERN: "^react$",
        KEY_SOFTWARE_RULES_14_NAME: "React",
        KEY_SOFTWARE_RULES_15_SOFTWARE_NAME_PATTERN: "^next$",
        KEY_SOFTWARE_RULES_15_NAME: "Next.js",
        KEY_SOFTWARE_RULES_16_SOFTWARE_NAME_PATTERN: "^@angular/core$",
        KEY_SOFTWARE_RULES_16_NAME: "Angular",
        SONARQUBE_BASE_URL: "https://sonarcloud.io",
        SONARQUBE_ORGANIZATIONS_0: "kronicle-tech",
      },
      secrets: {
        REPO_FINDERS_GITHUB_ORGANIZATIONS_0_ACCESS_TOKEN_USERNAME:
          ecs.Secret.fromSecretsManager(
            kronicleServiceConfigSecret,
            "kronicle-tech-github-username"
          ),
        REPO_FINDERS_GITHUB_ORGANIZATIONS_0_ACCESS_TOKEN_VALUE:
          ecs.Secret.fromSecretsManager(
            kronicleServiceConfigSecret,
            "kronicle-tech-github-access-token"
          ),
        REPO_FINDERS_GITHUB_ORGANIZATIONS_1_ACCESS_TOKEN_USERNAME:
          ecs.Secret.fromSecretsManager(
            kronicleServiceConfigSecret,
            "kronicle-computers-github-username"
          ),
        REPO_FINDERS_GITHUB_ORGANIZATIONS_1_ACCESS_TOKEN_VALUE:
          ecs.Secret.fromSecretsManager(
            kronicleServiceConfigSecret,
            "kronicle-computers-github-access-token"
          ),
      },
    });
    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      "KronicleEcsService",
      {
        serviceName: "kronicle",
        loadBalancerName: "kronicle",
        cluster,
        taskDefinition,
        assignPublicIp: true,
        recordType: ApplicationLoadBalancedServiceRecordType.CNAME,
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
}
