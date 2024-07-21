
# Screen Recording Annotator

## Overview

The Screen Recording Annotator is a web application that allows users to upload screen recordings from an iPhone, extract key frames by analyzing differences between frames, annotate these key frames with drawings and text, and export the annotated frames to a PDF. The application is designed to be largely self-contained and hosted entirely on the client side.

## Features

- Upload and process screen recordings (video files).
- Extract frames from the video at regular intervals.
- Analyze frames to determine significant changes and identify key frames.
- Display key frames in a gallery interface.
- Annotate key frames with drawings and text.
- Export annotated key frames to a PDF document.
- Responsive design to work on different devices, including mobile.
- Drag-and-drop functionality for file upload.

## Usage

### Initial Setup

1. Clone the repository or download the source files.
2. Open the `index.html` file in a web browser.

### Uploading a Screen Recording

1. Click on the upload area or drag and drop a video file into the upload area.
2. The application will load the video and start extracting frames at regular intervals.

### Extracting Key Frames

1. The application extracts frames from the video at 2-second intervals.
2. It analyzes the extracted frames to determine significant changes and identify key frames using a Mean Squared Error (MSE) algorithm.
3. The identified key frames are displayed in a gallery interface.

### Annotating Key Frames

1. Click on a key frame in the gallery to select it for annotation.
2. Use the drawing tools to annotate the key frame. The drawing tool is always enabled.
3. Add text annotations in the text area provided below the selected frame.

### Exporting to PDF

1. Select the key frames you want to export by checking the corresponding checkboxes.
2. Click on the "Export Annotations to PDF" button to generate a PDF document.
3. The PDF will include the annotated key frames with a light gray background and text annotations with a white background.
4. The generated PDF will be automatically downloaded.

### Handling Mobile Devices

- THIS DOESNT ACTUALLY WORK
- The application supports touch events for drawing on mobile devices.
- Ensure proper touch event handling for drawing and file upload functionality.

## Credits

DG Production (and a LLM)

---

### Technical Details

#### JavaScript Functions

- `handleFileUpload(file)`: Handles the video file upload and starts extracting frames.
- `extractFrames(video)`: Extracts frames from the video at regular intervals.
- `getPixelDifference(frame1, frame2)`: Calculates the Mean Squared Error (MSE) between two frames to identify significant changes.
- `extractKeyFrames(frames)`: Identifies key frames based on significant changes.
- `displayKeyFrames(frames)`: Displays the key frames in a gallery interface.
- `selectFrame(index)`: Selects a key frame for annotation.
- `startDrawing(event)`, `draw(event)`, `stopDrawing(event)`: Handle drawing annotations on the selected frame.
- `mergeCanvases(imageCanvas)`: Merges the original frame and the annotations into a single image for export.
- `export-pdf` click event: Exports the annotated frames to a PDF document.

#### HTML Structure

- `index.html`: The main HTML file containing the structure and elements for the application.
- `file-upload-container`: Container for the file upload area.
- `video-file`: Hidden file input element for uploading videos.
- `key-frames`: Container for displaying key frames.
- `selected-frame-container`: Container for displaying the selected frame for annotation.
- `text-annotation`: Text area for adding text annotations.
- `export-pdf`: Button for exporting annotated frames to a PDF.

---
