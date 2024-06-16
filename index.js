const url = 'http://100.79.222.112:7860/sdapi/v1/txt2img';
const axios = require('axios');
const fs = require('fs');

async function generateImage(prompt, model, seed) {
  try {
    const response = await axios.post(url, {
      prompt: prompt,
      seed: seed,
      sampler_name: 'Euler a',  // Adjust the sampler as needed
      steps: 20, // Number of steps
      width: 1024, // Width of the output image
      height: 1024, // Height of the output image
      cfg_scale: 7, // Classifier-Free Guidance Scale
      model: model // Model name
    });

    // Assuming the response contains a base64-encoded image
    const imageBase64 = response.data.images[0]; // Adjust based on actual response structure

    // Convert base64 to buffer
    const imageBuffer = Buffer.from(imageBase64, 'base64');

    // Write the buffer to a file
    fs.writeFileSync(+new Date() +'.png', imageBuffer);

    console.log('Image saved as output.png');
  } catch (error) {
    console.error('Error generating image:', error);
  }
}

// Define your parameters
const prompt = 'a futuristic cityscape with flying cars';
//const model = 'stable-diffusion-v1-4'; // Replace with the actual model name if different
const model = 'zavychromaxl_v70';
const seed = 123457;

// Call the function
generateImage(prompt, model, seed);
