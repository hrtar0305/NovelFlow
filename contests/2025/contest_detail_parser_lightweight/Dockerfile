# Use the official AWS Lambda Python 3.9 base image for arm64 architecture.
FROM public.ecr.aws/lambda/python:3.13-arm64

# Set the timezone to ensure consistent time-based operations.
ENV TZ=Asia/Seoul

# Set the working directory in the container.
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy the requirements file into the container.
COPY requirements.txt .

# Install the specified packages.
RUN pip install -r requirements.txt --target "${LAMBDA_TASK_ROOT}"

# Copy the handler function code into the container.
COPY lightweight_parser.py .

# Set the CMD to your handler function.
CMD [ "lightweight_parser.parse_contest_novel_details_lightweight" ]