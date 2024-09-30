const core = require('@actions/core');
const axios = require('axios');

var machineId;
var apiKey;

async function run() {
  try {
    apiKey = core.getInput('api_key');
    machineId = core.getInput('machine_id');
    const action = core.getInput('action');

    switch (action) {
        case 'start':
            await handleStart();
            break;
        case 'stop':
            await handleStop();
            break;
        default:
            core.setFailed(`Invalid action: ${action}`);
    }
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}\n${error.stack}`);
  }
}

async function handleStart() {
    // Get the current status
    let status = await getStatus();
    if (status === 'ready') {
        core.info('Machine is already running');
        return;
    }

    // Start the machine
    const response = await axios.patch(`https://api.paperspace.com/v1/machines/${machineId}/start`, {}, {
        headers: {
            'Authorization': `Bearer ${apiKey}`
        }
    });

    if (response.status !== 200) {
        throw new Error(`Failed to start machine with ID ${machineId}`);
    }

    for (let i = 0; i < 20; i++) {
        await waitFor(30);

        machine_status = await getStatus();
        if (machine_status === 'ready') {
            core.info('Machine is now running');
            return;
        }
    }

    core.setFailed('Machine failed to start. It appears to be stuck in a starting state');
}

async function getStatus() {
    const statusResponse = await axios.get(`https://api.paperspace.com/v1/machines/${machineId}`, {
        headers: {
            'Authorization': `Bearer ${apiKey}`
        }
    });

    if (statusResponse.status === 200) {
        return statusResponse.data.state;
    } else {
        throw new Error(`Failed to get status of machine with ID ${machineId}`);
    }
}

async function getWorkflowId(repo, token, workflowName) {
    const response = await axios.get(`https://api.github.com/repos/${repo}/actions/workflows`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json'
        }
    });

    if (response.status !== 200) {
        throw new Error(`Failed to list workflows: ${response.statusText}`);
    }

    const workflows = response.data.workflows;
    const workflow = workflows.find(wf => wf.name === workflowName);

    if (!workflow) {
        throw new Error(`Workflow with name "${workflowName}" not found.`);
    }

    return workflow.id;
}

async function handleStop() {
    const token = core.getInput('github_token');
    const workflowName = process.env.GITHUB_WORKFLOW;
    const repo = process.env.GITHUB_REPOSITORY;

    var workflowId = await getWorkflowId(repo, token, workflowName);

    core.info(`Checking if another workflow is queued for execution in ${repo} with workflow ${workflowId}`);

    const response = await axios.get(`https://api.github.com/repos/${repo}/actions/workflows/${workflowId}/runs?status=queued`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            "Accept" : "application/vnd.github+json",
            "X-GitHub-Api-Version" : "2022-11-28"
        }
    });
    
    if (response.status !== 200) {
        throw new Error(`Error getting a list of queued workflows`);
    }

    if (response.data.workflow_runs.length > 0) {
        core.info(`Not stopping VM as another workflow with that VM is queued for execution`);
        return;
    }

    var status = await getStatus();
    if (status === 'off') {
        core.info('Machine is already turned off');
        return;
    }

    if (status !== 'stopping') {
        const stopResponse = await axios.patch(`https://api.paperspace.com/v1/machines/${machineId}/stop`, {}, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });
        
        if (stopResponse.status !== 200) {
            throw new Error(`Failed to stop machine with ID ${machineId}`);
        }
    }

    for (let i = 0; i < 5; i++) {
        await waitFor(30);
        machine_status = await getStatus();
        console.log(machine_status);
        if (machine_status === 'off') {
            core.info('Machine is now turned off');
            return;
        }
    }
}

function waitFor(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

run();
