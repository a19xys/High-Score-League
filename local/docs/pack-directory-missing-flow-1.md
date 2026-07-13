# Biblioteca de packs no disponible

El launcher distingue entre una biblioteca sin configurar, una carpeta existente y vacía, packs individuales con errores y una carpeta configurada que ha desaparecido o no es accesible.

Si la biblioteca estaba en un disco extraíble, una unidad de red o una carpeta movida, el launcher muestra el diálogo **No se encuentra la carpeta de packs**. Desde ahí se puede escoger otra carpeta o cancelar. Cancelar cierra el aviso sin borrar la ruta configurada, favoritos, colas ni otros datos locales.

## Jerarquía de acciones

Mientras la carpeta no está disponible, las acciones de recuperación viven únicamente en dos lugares:

- el diálogo inicial, con **Escoger carpeta** como acción primaria y **Cancelar** como secundaria;
- la cabecera de Biblioteca, con **Cambiar ubicación** y el icono **Reescanear**.

La tarjeta informativa y el detalle derecho no duplican estas acciones. El botón **Filtros** queda cerrado y deshabilitado (aria-expanded=false y aria-disabled=true) para los estados missing e inaccessible. Al recuperar la biblioteca vuelve a estar disponible, pero no se abre automáticamente.

En los diálogos, las acciones primarias usan --circuit con texto e iconos --text-inverse tanto en tema claro como oscuro. Las secundarias usan una superficie y un borde visibles. En ventanas normales las acciones de recuperación comparten fila; en ventanas estrechas se apilan a ancho completo. En **¿Qué quieres importar?**, Archivo ZIP y Carpeta comparten la variante primaria y Cancelar ocupa una fila secundaria.

## Hero de marca

El detalle derecho usa el hero de marca cuando no existe un pack activo válido por una biblioteca no disponible, sin configurar o vacía. El asset opcional se espera exactamente en:

**local/hsl-local-app/gui/renderer/assets/hero_hsl.png**

La imagen respeta el mismo contenedor y proporción que el hero de packs mediante object-fit: cover. Si el archivo todavía no existe o falla al cargar, el renderer oculta la imagen rota y conserva un fallback CSS neutro con la marca HSL. El empty state solo muestra un título y un texto de orientación; no presenta metadata, badges, actividad local ni acciones de juego o recuperación.

