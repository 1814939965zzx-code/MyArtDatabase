# Vendored from the official ResourceSpace Docker repository for a reproducible
# integration spike: https://github.com/resourcespace/docker
FROM ubuntu:24.04

LABEL org.opencontainers.image.authors="Montala Ltd"

ENV DEBIAN_FRONTEND="noninteractive"
ARG UBUNTU_MIRROR="http://ports.ubuntu.com/ubuntu-ports"
RUN sed -i "s|http://ports.ubuntu.com/ubuntu-ports|${UBUNTU_MIRROR}|g" /etc/apt/sources.list.d/ubuntu.sources \
 && apt-get update && apt-get install -y \
    nano \
    imagemagick \
    apache2 \
    subversion \
    ghostscript \
    antiword \
    poppler-utils \
    libimage-exiftool-perl \
    cron \
    postfix \
    wget \
    php \
    php-apcu \
    php-curl \
    php-dev \
    php-gd \
    php-intl \
    php-mysqlnd \
    php-mbstring \
    php-zip \
    libapache2-mod-php \
    ffmpeg \
    python3 \
    python3-pip \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*
RUN sed -i -e "s/upload_max_filesize\s*=\s*2M/upload_max_filesize = 50M/g" /etc/php/8.3/apache2/php.ini \
 && sed -i -e "s/post_max_size\s*=\s*8M/post_max_size = 55M/g" /etc/php/8.3/apache2/php.ini \
 && sed -i -e "s/max_execution_time\s*=\s*30/max_execution_time = 300/g" /etc/php/8.3/apache2/php.ini \
 && sed -i -e "s/memory_limit\s*=\s*128M/memory_limit = 1G/g" /etc/php/8.3/apache2/php.ini
RUN printf '<Directory /var/www/>\n\
\tOptions FollowSymLinks\n\
</Directory>\n'\
>> /etc/apache2/sites-enabled/000-default.conf

ADD cronjob /etc/cron.daily/resourcespace

WORKDIR /var/www/html

ARG RS_SOURCE_COMMIT="b5922763d62f4e654e7b55422091ffcd1c76e814"
RUN rm -f index.html \
 && wget --continue --tries=10 --timeout=60 \
      -O /tmp/resourcespace.tar.gz \
      "https://codeload.github.com/resourcespace/resourcespace/tar.gz/${RS_SOURCE_COMMIT}" \
 && tar -xzf /tmp/resourcespace.tar.gz --strip-components=1 \
 && rm /tmp/resourcespace.tar.gz \
 && mkdir -p filestore \
 && chmod 777 filestore \
 && chmod -R 777 include/

RUN apt-get update \
 && apt-get install -y composer \
 && composer install --no-dev --no-interaction --optimize-autoloader \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
