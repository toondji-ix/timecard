# AWS face verification setup for Render

The app already uses Rekognition Face Liveness and face collections. This setup connects that implementation to your AWS account. It does not change attendance rules or add other services.

## 1. Create the app's AWS permissions

1. Sign in to the AWS console with permission to create IAM users, roles and policies and CloudFormation stacks.
2. Set the console region to **Europe (Ireland), eu-west-1**. This region supports Face Liveness streaming. The supplied template intentionally requires this region.
3. Open **CloudFormation → Create stack → With new resources (standard)**.
4. Select **Choose an existing template → Upload a template file**. Upload `infrastructure/aws-face.json` from this project.
5. Name the stack `timecard-face`. Continue with the default stack settings.
6. Review the resources, acknowledge that CloudFormation will create IAM resources, and submit. Wait for **CREATE_COMPLETE**.
7. Open the stack's **Outputs**. Keep `BackendUserName`, `LivenessRoleArn` and `Region` available for the next steps. These are identifiers, not secret keys.

The stack creates one dedicated backend IAM user without console login or access keys, one camera-streaming role and a backend policy. The role trusts only the dedicated user. Collection access is restricted to `timecard-*` in this account and region. Liveness and CreateCollection actions require wildcard resources because AWS does not support collection resource restrictions for those actions; they remain region-restricted. Neither identity receives administrator access or S3 permissions.

## 2. Create the Render access key

1. Open **IAM → Users** and select the user named by `BackendUserName` in the stack outputs.
2. Open **Security credentials → Access keys → Create access key**.
3. Choose **Application running outside AWS**, then complete creation.
4. Copy the Access key ID and Secret access key directly into Render's environment settings below. AWS displays the secret only at creation. Do not paste either value into chat, source files, screenshots or public variables.

Do not create root-user access keys or use a personal administrator key. When rotating this key, save the replacement in Render, redeploy and verify camera operation before deactivating the old key.

## 3. Configure the existing Render Web Service

In **Render → Timecard service → Environment**, save:

| Variable | Value |
| --- | --- |
| `AWS_REGION` | `eu-west-1` |
| `AWS_ACCESS_KEY_ID` | Access key ID from the dedicated user |
| `AWS_SECRET_ACCESS_KEY` | Secret access key from the dedicated user |
| `AWS_LIVENESS_ROLE_ARN` | Exact `LivenessRoleArn` from CloudFormation Outputs |
| `LIVENESS_THRESHOLD` | `95` |

Keep the existing `DATA_ENCRYPTION_KEY` unchanged. It must contain 64 hexadecimal characters; it encrypts stored face identifiers. These server settings must never use a `NEXT_PUBLIC_` prefix. Remove any stale `AWS_SESSION_TOKEN` if using this dedicated user's long-lived access key. Save and redeploy.

No Cognito pool, S3 bucket or AWS-hosted frontend is needed by this implementation. The backend creates a workspace's collection during first enrollment. It issues temporary, 15-minute streaming credentials to the camera component; the backend key is never returned to the browser. Images are processed transiently, with zero requested audit images and no S3 output configured. AWS stores enrolled face vectors; the app stores encrypted face IDs.

## 4. Verify on the deployed app

1. Use the HTTPS Render URL, sign in and select the existing workspace.
2. Accept the biometric/location notice and allow camera access.
3. Complete face enrollment in good lighting. Then test check-in from inside the configured work location and check-out when appropriate.
4. Verify that a different face fails and the existing manual approval path remains available.

The missing-configuration banner only checks whether region/role settings exist. Its disappearance alone does not prove valid credentials or permissions. Real enrollment and matching need a physical camera test; no fake biometric success is supplied.

If AWS returns `AccessDenied`, check that the access key belongs to the stack's backend user, its permissions are attached, and `AWS_LIVENESS_ROLE_ARN` matches the same stack. Organization permission boundaries or service control policies may also deny access. If it reports invalid credentials, recheck the Render keys and remove a stale session token. After fixing environment values, redeploy. Share only a sanitized error message when requesting help.

Rekognition liveness checks, image operations and face-vector storage can incur usage charges. Review AWS pricing before the live camera test. No paid AWS API calls or live resource creation were performed while preparing these files.

References: [AWS Face Liveness integration](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-programming-api.html), [supported streaming regions](https://docs.aws.amazon.com/general/latest/gr/rekognition.html), [Rekognition IAM actions](https://docs.aws.amazon.com/de_de/service-authorization/latest/reference/list_amazonrekognition.html), [pricing](https://aws.amazon.com/rekognition/pricing/).
