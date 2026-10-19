# 1. Use a lightweight Python base image
FROM python:3.10-slim

# 2. Set the working directory inside the container
WORKDIR /app

# Install system dependencies required by OpenCV (installed by Ultralytics)
RUN apt-get update && apt-get install -y libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

# 3. Copy the requirements file first to leverage Docker cache
COPY requirements.txt .

# 4. Install the required Python packages
# Upgrade pip and trust PyPI hosts to prevent network/resolution errors
RUN pip install --no-cache-dir --upgrade pip
RUN pip install --no-cache-dir --trusted-host pypi.org --trusted-host files.pythonhosted.org -r requirements.txt

# 5. Copy the Python worker script and trained weights into the container
COPY worker.py .
COPY best.pt* .
COPY fracture_best.pt* .
COPY bone_classifier_best.pt* .

# Create a non-root user and switch to it
RUN useradd -m workeruser && chown -R workeruser:workeruser /app
USER workeruser

# 6. Define the command to run the worker script when the container starts
CMD ["python", "worker.py"]