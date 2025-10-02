FROM public.ecr.aws/lambda/python:3.13

WORKDIR ${LAMBDA_TASK_ROOT}

ENV TZ=Asia/Seoul
ENV PLAYWRIGHT_BROWSERS_PATH=/var/task/ms-playwright

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN dnf install -y \
    alsa-lib \
    atk \
    at-spi2-atk \
    cups-libs \
    gtk3 \
    libXcomposite \
    libXdamage \
    libXext \
    libXfixes \
    libXrandr \
    libXtst \
    pango \
    nss \
    libdrm \
    libxshmfence \
    mesa-libgbm \
    && dnf clean all
RUN playwright install chromium

COPY . .

CMD [ "parser.parse_contest_novel_details_batch" ]