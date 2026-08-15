#!/bin/bash

service cron start
chmod +x /etc/cron.daily/*
apachectl -D FOREGROUND

