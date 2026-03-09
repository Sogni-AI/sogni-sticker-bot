const { SogniClient } = require('@sogni-ai/sogni-client');
require('dotenv').config();

async function run() {
    try {
        const sogni = await SogniClient.createInstance({
            appId: process.env.APP_ID,
            network: 'fast',
            restEndpoint: process.env.REST_ENDPOINT,
            socketEndpoint: process.env.SOCKET_ENDPOINT
        });

        await sogni.account.login(process.env.SOGNI_USERNAME, process.env.SOGNI_PASSWORD);

        console.log('Creating audio project...');
        const project = await sogni.projects.create({
            type: 'audio',
            tokenType: 'spark',
            modelId: 'ace_step_1.5_turbo',
            positivePrompt: 'A catchy electronic beat',
            numberOfMedia: 1,
            network: 'fast',
            seconds: 5 // Guessing param for length
        });

        console.log('Project created:', project.id);
        const result = await project.waitForCompletion();

        console.log('Result:', result);
        process.exit(0);
    } catch (e) {
        if (e.response && e.response.data) {
            console.error('API Error:', e.response.data);
        } else {
            console.error('Error:', e.message);
        }
        process.exit(1);
    }
}

run();
