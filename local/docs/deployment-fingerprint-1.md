# DEPLOYMENT-FINGERPRINT-1

El servidor obtiene una identidad no sensible, por prioridad, de SHA de Vercel,
deployment ID, version de build o `unknown`. Se limita a caracteres seguros y
no contiene variables privadas, proyecto Supabase ni tokens.

Health expone build, environment y version de contrato en headers. Ranking
incluye los mismos valores en body y headers. Electron guarda la identidad con
su propia generacion, segmenta la cache y exige paridad health/Ranking. Un cambio
de origen borra la identidad. En desarrollo, ambos builds `unknown` son
compatibles si entorno y contrato coinciden.

El smoke acepta `HSL_EXPECTED_DEPLOYMENT_SHA`; si se define, un build distinto
produce exit code no cero. No existe SHA esperado fijo en el repositorio.

La verificacion final requiere desplegar el commit resultante y comparar la
salida del smoke con ese SHA. El despliegue anterior a esta tarea no publicaba
los headers, por lo que no debe presentarse como verificado.
