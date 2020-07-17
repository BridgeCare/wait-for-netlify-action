const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');

function getNetlifyUrl(url) {
  return axios.get(url, {
    headers: {
      Authorization: `Bearer ${process.env.NETLIFY_TOKEN}`,
    },
  });
}

const waitForReadiness = (url, MAX_TIMEOUT) => {
  return new Promise((resolve, reject) => {
    let elapsedTimeSeconds = 0;

    const handle = setInterval(async () => {
      elapsedTimeSeconds += 30;

      if (elapsedTimeSeconds >= MAX_TIMEOUT) {
        clearInterval(handle);
        return reject(`Timeout reached: Deployment was not ready within ${MAX_TIMEOUT} seconds.`);
      }

      const deploy = await getNetlifyUrl(url);

      if (deploy.state === 'ready' || deploy.state === 'current') {
        clearInterval(handle);
        resolve();
      } else if (deploy.state === 'building') {
        console.log('Deployment not yet ready, waiting 30 seconds...');
      } else {
        clearInterval(handle);
        reject(`Netlify deployment not available with state: ${deploy.state}.`);
      }
    }, 30000);
  });
};

const waitForUrl = async (url, MAX_TIMEOUT) => {
  const iterations = MAX_TIMEOUT / 3;
  for (let i = 0; i < iterations; i++) {
    try {
      await axios.get(url);
      return;
    } catch (e) {
      console.log(`URL ${url} unavailable, retrying...`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  core.setFailed(`Timeout reached: Unable to connect to ${url}`);
};

const run = async () => {
  try {
    const netlifyToken = process.env.NETLIFY_TOKEN;
    const commitSha = github.context.sha;
    const MAX_WAIT_TIMEOUT = 900; // 15 min
    const MAX_READY_TIMEOUT = Number(core.getInput('max_timeout')) || 60;
    const siteId = core.getInput('site_id');

    if (!netlifyToken) {
      core.setFailed('Please set NETLIFY_TOKEN env variable to your Netlify Personal Access Token secret');
    }
    if (!commitSha) {
      core.setFailed('Could not determine GitHub commit');
    }
    if (!siteId) {
      core.setFailed('Required field `site_id` was not provided');
    }

    const { data: netlifyDeployments } = await getNetlifyUrl(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`);

    if (!netlifyDeployments) {
      core.setFailed(`Failed to get deployments for site`);
    }

    const commitDeployment = netlifyDeployments.find((d) => d.commit_ref === commitSha);

    if (!commitDeployment) {
      core.setFailed(`Could not find deployment for commit ${commitSha}`);
    }

    const url = `https://${commitDeployment.id}--${commitDeployment.name}.netlify.app`;

    core.setOutput('deploy_id', commitDeployment.id);
    core.setOutput('url', url);

    console.log(`Waiting for Netlify deployment ${commitDeployment.id} to be ready`);
    await waitForReadiness(
      `https://api.netlify.com/api/v1/sites/${siteId}/deploys/${commitDeployment.id}`,
      MAX_WAIT_TIMEOUT
    );

    console.log(`Waiting for a 200 from: ${url}`);
    await waitForUrl(url, MAX_READY_TIMEOUT);
  } catch (error) {
    core.setFailed(typeof error === 'string' ? error : error.message);
  }
};

run();
