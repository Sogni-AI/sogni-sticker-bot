const {SogniClient} = require('@sogni-ai/sogni-client');

const sogniPromise = SogniClient
    .createInstance({
        appId: process.env.APP_ID,
        restEndpoint: 'https://api.sogni.ai',
        socketEndpoint: 'https://socket.sogni.ai',
        testnet: true,
        network: 'fast'
    })
    .then(async (sogni) => {
        console.log('Sogni API client initialized');
        sogni.apiClient.on('connected', () => {
            console.log('Connected to Sogni API');
        })

        sogni.apiClient.on('disconnected', ({code, reason}) => {
            console.error('Disconnected from Sogni API', code, reason);
            setTimeout(() => {
                process.exit(1);
            }, 100);
        });
        await sogni.account.login(process.env.SOGNI_USERNAME, process.env.SOGNI_PASSWORD);
        return sogni;
    })
    .catch((error) => {
        console.error('Error initializing Sogni API client', error);
        setTimeout(() => {
            process.exit(1);
        }, 100);
    });

module.exports = sogniPromise;
