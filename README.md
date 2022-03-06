# Kronicle CDK Config

This is an example CDK project for deploying Kronicle to AWS ECS+Fargate.  This project is used to deploy Kronicle
for https://demo.kronicle.tech/ but can also be forked and used by anyone to deploy Kronicle to AWS.   

The main part of the codebase is [lib/kronicle-stack.ts](lib/kronicle-stack.ts) which contains the CDK-based 
Infrastructure as Code (IaC) for deploying Kronicle. 


## Useful Commands

* `npm run build`          compile typescript to js
* `npm run watch`          watch for changes and compile
* `npm run test`           run the jest unit tests
* `npm run cdk -- deploy`  deploy this stack to your default AWS account/region
* `npm run cdk -- diff`    compare deployed stack with current state
* `npm run cdk -- synth`   emits the synthesized CloudFormation template
