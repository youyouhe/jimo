# ---- Stage 1: Maven build ----
FROM maven:3.8-eclipse-temurin-17 AS builder

WORKDIR /build
COPY pom.xml .
RUN mvn dependency:go-offline -B          # cache dependencies layer

COPY src ./src
RUN mvn clean package -DskipTests -B

# ---- Stage 2: JRE runtime ----
FROM eclipse-temurin:17-jre

LABEL maintainer="bpm-service"
ENV TZ=Asia/Shanghai
RUN ln -sf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone \
    && apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /build/target/bpm-service-1.0.0.jar app.jar

# Spring Boot actuator health is available at /bpm/api/health
EXPOSE 8090

ENTRYPOINT ["java", "-jar", "app.jar"]
