let isDrawing = false;
let textAnnotations = {};
let selectedFrameIndex = null;
let frames = [];
let canvases = [];
let annotationContext = null;
let selectedFrameCanvas = null;

const videoFileInput = document.getElementById('video-file');
const fileUploadContainer = document.getElementById('file-upload-container');

videoFileInput.addEventListener('change', function(event) {
    handleFileUpload(event.target.files[0]);
});

fileUploadContainer.addEventListener('click', () => {
    videoFileInput.click();
});

fileUploadContainer.addEventListener('dragover', (event) => {
    event.preventDefault();
    fileUploadContainer.classList.add('dragover');
});

fileUploadContainer.addEventListener('dragleave', () => {
    fileUploadContainer.classList.remove('dragover');
});

fileUploadContainer.addEventListener('drop', (event) => {
    event.preventDefault();
    fileUploadContainer.classList.remove('dragover');
    if (event.dataTransfer.files.length > 0) {
        handleFileUpload(event.dataTransfer.files[0]);
    }
});

function handleFileUpload(file) {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.src = url;

    video.addEventListener('loadeddata', () => {
        extractFrames(video);
    });
}

function extractFrames(video) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const interval = 2; // Extract frame every 2 seconds
    frames = [];

    video.currentTime = 0;

    video.addEventListener('seeked', async function extractFrame() {
        if (video.currentTime >= video.duration) {
            const keyFrames = await extractKeyFrames(frames);
            keyFrames.forEach((frame, index) => {
                textAnnotations[index] = ''; // Initialize textAnnotations
            });
            displayKeyFrames(keyFrames);
            return;
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL());

        video.currentTime = Math.min(video.currentTime + interval, video.duration);
    });

    video.currentTime = 0; // Start extracting frames
}

async function getPixelDifference(frame1, frame2) {
    const img1 = new Image();
    const img2 = new Image();
    
    img1.src = frame1;
    img2.src = frame2;
    
    return new Promise((resolve) => {
        img1.onload = () => {
            img2.onload = () => {
                const canvas1 = document.createElement('canvas');
                const canvas2 = document.createElement('canvas');
                
                canvas1.width = img1.width;
                canvas1.height = img1.height;
                canvas2.width = img2.width;
                canvas2.height = img2.height;
                
                const ctx1 = canvas1.getContext('2d');
                const ctx2 = canvas2.getContext('2d');
                
                ctx1.drawImage(img1, 0, 0);
                ctx2.drawImage(img2, 0, 0);
                
                const imageData1 = ctx1.getImageData(0, 0, canvas1.width, canvas1.height);
                const imageData2 = ctx2.getImageData(0, 0, canvas2.width, canvas2.height);
                
                const data1 = imageData1.data;
                const data2 = imageData2.data;
                
                let diff = 0;
                
                for (let i = 0; i < data1.length; i += 4) {
                    const r1 = data1[i];
                    const g1 = data1[i + 1];
                    const b1 = data1[i + 2];
                    
                    const r2 = data2[i];
                    const g2 = data2[i + 1];
                    const b2 = data2[i + 2];
                    
                    const gray1 = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;
                    const gray2 = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;
                    
                    diff += Math.pow(gray1 - gray2, 2);
                }
                
                const mse = diff / (data1.length / 4);
                resolve(mse);
            };
        };
    });
}

async function extractKeyFrames(frames) {
    const keyFrames = [];
    let lastFrame;

    for (let index = 0; index < frames.length; index++) {
        const frame = frames[index];
        if (!lastFrame) {
            lastFrame = frame;
            keyFrames.push(frame);
            continue;
        }

        const diff = await getPixelDifference(lastFrame, frame);
        // Adjust the threshold based on experimentation
        if (diff > 1000) { 
            keyFrames.push(frame);
            lastFrame = frame;
        }
    }

    return keyFrames;
}

function displayKeyFrames(frames) {
    const keyFramesContainer = document.getElementById('key-frames');
    keyFramesContainer.innerHTML = '';

    frames.forEach((frame, index) => {
        const frameElement = document.createElement('div');
        frameElement.className = 'frame';
        frameElement.dataset.index = index;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'frame-checkbox';

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.src = frame;

        img.onload = () => {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            ctx.drawImage(img, 0, 0);
        };

        canvases.push(canvas);
        frameElement.appendChild(checkbox);
        frameElement.appendChild(canvas);
        keyFramesContainer.appendChild(frameElement);

        frameElement.addEventListener('click', (e) => {
            if (e.target.tagName !== 'INPUT') {
                selectFrame(index);
            }
        });
    });
}

function selectFrame(index) {
    selectedFrameIndex = index;

    // Highlight the selected frame
    document.querySelectorAll('.frame').forEach(frame => {
        frame.style.border = '1px solid #fff'; // Invert border color
    });
    document.querySelector(`.frame[data-index='${index}']`).style.border = '3px solid #ff0000';

    const selectedFrameContainer = document.getElementById('selected-frame-container');
    selectedFrameCanvas = document.getElementById('selected-frame');
    annotationContext = selectedFrameCanvas.getContext('2d');
    const img = new Image();
    img.src = canvases[index].toDataURL();

    img.onload = () => {
        const aspectRatio = img.naturalWidth / img.naturalHeight;
        const containerWidth = selectedFrameContainer.clientWidth;
        const containerHeight = containerWidth / aspectRatio;

        selectedFrameCanvas.width = containerWidth;
        selectedFrameCanvas.height = containerHeight;

        // Draw the image and existing annotations
        annotationContext.clearRect(0, 0, selectedFrameCanvas.width, selectedFrameCanvas.height);
        annotationContext.drawImage(img, 0, 0, selectedFrameCanvas.width, selectedFrameCanvas.height);

        // Update text annotation
        document.getElementById('text-annotation').value = textAnnotations[index] || '';
    };

    selectedFrameContainer.classList.add('active');

    selectedFrameCanvas.onmousedown = startDrawing;
    selectedFrameCanvas.onmousemove = draw;
    selectedFrameCanvas.onmouseup = stopDrawing;
    selectedFrameCanvas.onmouseleave = stopDrawing; // Stop drawing if the cursor leaves the canvas

    // Handle touch events for drawing
    selectedFrameCanvas.addEventListener('touchstart', startDrawing);
    selectedFrameCanvas.addEventListener('touchmove', draw);
    selectedFrameCanvas.addEventListener('touchend', stopDrawing);
    selectedFrameCanvas.addEventListener('touchcancel', stopDrawing);
}

function startDrawing(event) {
    event.preventDefault();
    const rect = selectedFrameCanvas.getBoundingClientRect();
    isDrawing = true;
    const clientX = event.clientX || event.touches[0].clientX;
    const clientY = event.clientY || event.touches[0].clientY;
    annotationContext.beginPath();
    annotationContext.moveTo(clientX - rect.left, clientY - rect.top);
}

function draw(event) {
    if (!isDrawing) return;
    event.preventDefault();
    const rect = selectedFrameCanvas.getBoundingClientRect();
    const clientX = event.clientX || event.touches[0].clientX;
    const clientY = event.clientY || event.touches[0].clientY;
    annotationContext.lineTo(clientX - rect.left, clientY - rect.top);
    annotationContext.strokeStyle = 'red'; // Make the line red
    annotationContext.lineWidth = 5; // Make the line thicker
    annotationContext.stroke();
}

function stopDrawing(event) {
    if (!isDrawing) return;
    isDrawing = false;
    annotationContext.closePath();

    // Save the annotations on the selected frame's canvas
    const selectedAnnotationCanvas = canvases[selectedFrameIndex];
    const tempCanvas = document.createElement('canvas');
    const tempContext = tempCanvas.getContext('2d');
    tempCanvas.width = selectedAnnotationCanvas.width;
    tempCanvas.height = selectedAnnotationCanvas.height;

    // Draw the original image
    const img = new Image();
    img.src = selectedAnnotationCanvas.toDataURL();
    img.onload = () => {
        tempContext.drawImage(img, 0, 0);
        tempContext.drawImage(selectedFrameCanvas, 0, 0, selectedAnnotationCanvas.width, selectedAnnotationCanvas.height);
        selectedAnnotationCanvas.width = tempCanvas.width;
        selectedAnnotationCanvas.height = tempCanvas.height;
        const annotationContext = selectedAnnotationCanvas.getContext('2d');
        annotationContext.clearRect(0, 0, selectedAnnotationCanvas.width, selectedAnnotationCanvas.height);
        annotationContext.drawImage(tempCanvas, 0, 0);
    };
}

document.getElementById('text-annotation').addEventListener('input', function() {
    textAnnotations[selectedFrameIndex] = this.value;
});

document.getElementById('export-pdf').addEventListener('click', () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxImgHeight = pageHeight - 60; // Leave space for the text and margin

    const selectedCanvases = [];
    document.querySelectorAll('.frame-checkbox').forEach((checkbox, index) => {
        if (checkbox.checked) {
            selectedCanvases.push({ canvas: canvases[index], index: index });
        }
    });

    selectedCanvases.forEach((item, pageIndex) => {
        const canvas = item.canvas;
        const index = item.index;
        if (pageIndex > 0) doc.addPage();

        const canvasAspect = canvas.width / canvas.height;
        let imgWidth = pageWidth - margin * 2;
        let imgHeight = maxImgHeight;

        if (imgWidth / imgHeight > canvasAspect) {
            imgWidth = imgHeight * canvasAspect;
        } else {
            imgHeight = imgWidth / canvasAspect;
        }

        const x = (pageWidth - imgWidth) / 2;
        const y = margin;

        const imgData = mergeCanvases(canvas);
        doc.setFillColor(220, 220, 220); // Light gray background
        doc.rect(0, y, pageWidth, imgHeight, 'F'); // Draw filled rectangle as background for the full page width
        doc.addImage(imgData, 'PNG', x, y, imgWidth, imgHeight);

        if (textAnnotations[index]) {
            const textY = y + imgHeight + 10; // Position text below the image
            doc.setFillColor(255, 255, 255); // White background for text
            doc.rect(0, textY - 10, pageWidth, pageHeight - textY + 10, 'F'); // Draw filled rectangle as background for text
            doc.setTextColor(0, 0, 0); // Set text color to black

            // Split text into lines that fit within the page width
            const text = textAnnotations[index];
            const lines = doc.splitTextToSize(text, pageWidth - 2 * margin);

            // Check if the text fits on the current page
            let availableHeight = pageHeight - textY - margin;
            let lineHeight = doc.getTextDimensions('M').h;

            if (lines.length * lineHeight > availableHeight) {
                let currentPageLines = Math.floor(availableHeight / lineHeight);
                let remainingLines = lines.slice(currentPageLines);

                // Print the current page's lines
                doc.text(lines.slice(0, currentPageLines), margin, textY);

                while (remainingLines.length > 0) {
                    doc.addPage();
                    doc.setFillColor(255, 255, 255); // White background for text
                    doc.rect(0, margin, pageWidth, pageHeight - margin, 'F'); // Draw filled rectangle as background for text

                    if (remainingLines.length * lineHeight > pageHeight - 2 * margin) {
                        currentPageLines = Math.floor((pageHeight - 2 * margin) / lineHeight);
                        doc.text(remainingLines.slice(0, currentPageLines), margin, margin);
                        remainingLines = remainingLines.slice(currentPageLines);
                    } else {
                        doc.text(remainingLines, margin, margin);
                        remainingLines = [];
                    }
                }
            } else {
                doc.text(lines, margin, textY);
            }
        }
    });

    doc.save('annotated_frames.pdf');
});

function mergeCanvases(imageCanvas) {
    const tempCanvas = document.createElement('canvas');
    const tempContext = tempCanvas.getContext('2d');
    tempCanvas.width = imageCanvas.width;
    tempCanvas.height = imageCanvas.height;

    tempContext.drawImage(imageCanvas, 0, 0);

    // Draw the annotation layer
    const annotationImage = new Image();
    annotationImage.src = imageCanvas.toDataURL();
    annotationImage.onload = () => {
        tempContext.drawImage(annotationImage, 0, 0);
    };

    return tempCanvas.toDataURL('image/png');
}
