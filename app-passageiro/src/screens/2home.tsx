const handleDriverArrived = () => {
      if (!isMountedRef.current) return;
      setRideStatus('arrived');
      if (activeRideIdRef.current) persistRideState(activeRideIdRef.current, 'arrived');
      Alert.alert(t('driver_arrived_title', 'Motorista no Local! 📍'), t('driver_arrived_alert_msg', 'Seu motorista chegou ao ponto de partida e está te aguardando.'));
    };

    const handleRideStarted = () => { 
      if (!isMountedRef.current) return;
      setRideStatus('in_progress'); 
      setIsChatVisible(false); 
      if (activeRideIdRef.current) persistRideState(activeRideIdRef.current, 'in_progress');
    };

    const handleRideFinished = () => { 
      if (!isMountedRef.current) return;
      setRideStatus('completed');
      setShowRatingModal(true); 
    };

    const handleRideCancelled = (data: any) => {
      if (!isMountedRef.current) return;
      
      if (data?.cancelledBy === 'DRIVER') {
        Alert.alert(t('warning_title', 'Aviso ⚠️'), t('driver_cancelled_msg', 'O motorista cancelou a corrida. Por favor, solicite um novo veículo.'));
      } else {
        Alert.alert(t('cancelled_title', 'Cancelado'), data?.appliedPenalty ? `${t('cancellation_fee', 'Taxa de cancelamento:')} ${data.penaltyAmount} XOF.` : t('ride_cancelled_msg', 'Sua corrida foi cancelada.'));
      }
      
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      persistRideState(null, 'idle');
      setActiveRideId(null);
      setRideStatus('idle');
      setDriverInfo(null);
      setDriverLocation(null);
      setStartOtp('');
      
      if (activeRideIdRef.current) activeRideIdRef.current = null;
      resetRideState();
    };
   
    const handleReceiveMessage = (messageData: any) => {
      if (!isMountedRef.current || !messageData?.text) return;
      setMessages(prev => {
        const messageId = messageData.id || `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        if (prev.some(msg => msg.id === messageId)) return prev;
        return [...prev, { id: messageId, sender: 'driver', text: String(messageData.text) }];
      });
    };

    const handleNoDriversFound = () => {
      if (!isMountedRef.current) return;
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      Alert.alert(t('search_ended_title', 'Busca Encerrada'), t('no_drivers_found_msg', 'Não encontramos motoristas disponíveis na sua região. Tente novamente.'));
      resetRideState();
    };
    
    const handlePriceCalculated = (data: any) => {
      if (!isMountedRef.current || !data) return;
      if (typeof data.price === 'number') setEstimatedPrice(data.price);
      if (typeof data.distance === 'number') setEstimatedDistance(data.distance);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('passenger:state_recovered', handleStateRecovered);
    socket.on('driver:position', handleDriverPosition);
    socket.on('ride:accepted', handleRideAccepted);
    socket.on('ride:driver_arrived', handleDriverArrived);
    socket.on('ride:started', handleRideStarted);
    socket.on('ride:finished', handleRideFinished);
    socket.on('ride:cancelled', handleRideCancelled);
    socket.on('chat:receive_message', handleReceiveMessage);
    socket.on('ride:no_drivers_found', handleNoDriversFound);
    socket.on('ride:price_calculated', handlePriceCalculated);
    socket.on('ride:inaccessible_location', handleInaccessibleLocationAlert);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('passenger:state_recovered', handleStateRecovered);
      socket.off('driver:position', handleDriverPosition);
      socket.off('ride:accepted', handleRideAccepted);
      socket.off('ride:driver_arrived', handleDriverArrived);
      socket.off('ride:started', handleRideStarted);
      socket.off('ride:finished', handleRideFinished);
      socket.off('ride:cancelled', handleRideCancelled);
      socket.off('chat:receive_message', handleReceiveMessage);
      socket.off('ride:no_drivers_found', handleNoDriversFound);
      socket.off('ride:price_calculated', handlePriceCalculated);
      socket.off('ride:inaccessible_location', handleInaccessibleLocationAlert);
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [getCurrentLocationWithFallback, handleInaccessibleLocationAlert, resetRideState, t]);

  useEffect(() => {
    let origin = pickupCoords;
    let destination = dropoffCoords;
    let extra = extraStopCoords;

    if (rideStatus === 'accepted' && driverLocation) {
      origin = driverLocation;
      destination = pickupCoords;
      extra = null;
    } else if (rideStatus === 'in_progress' && driverLocation) {
      origin = driverLocation;
      destination = dropoffCoords;
      extra = extraStopCoords;
    }

    if (origin && destination) {
      let fitPoints = [origin, destination];
      if (extra) fitPoints.push(extra);
      
      fitMapBounds(fitPoints);
      fetchMapboxRoute(origin, destination, extra);
    }
  }, [pickupCoords, dropoffCoords, extraStopCoords, driverLocation, rideStatus, fitMapBounds, fetchMapboxRoute]);

  useEffect(() => {
    if (route.params?.openChat) {
      setIsChatVisible(true);
      navigation.setParams({ openChat: undefined });
    }
  }, [route.params?.openChat, navigation]);

  useEffect(() => {
    if (pickupCoords && dropoffCoords) {
      setEstimatedPrice(null); 
      calculateEstimate(pickupCoords, dropoffCoords, extraStopCoords);
    }
  }, [pickupCoords, dropoffCoords, extraStopCoords, serviceType, vehicleType, calculateEstimate]);

  async function handleInitialRequestRide() {
    const needsDropoff = serviceType !== 'aluguel';
    if (!pickupCoords || (needsDropoff && !dropoffCoords) || !user?.id) {
      Alert.alert(
        t('warning_title', 'Aviso ⚠️'), 
        t('select_origin_destination_msg', 'Selecione a origem e o destino antes de solicitar.')
      );
      return;
    }

    if (paymentMethod === 'CASH') {
      executeRideRequest();
    } else {
      if (!paymentPhone && user?.phone) {
        setPaymentPhone(user.phone);
      }
      setIsPaymentModalVisible(true);
    }
  }

  async function confirmPaymentAndRide() {
    if (!user?.id) {
      Alert.alert(t('error_title', 'Erro'), t('missing_user_data', 'Dados de usuário não encontrados.'));
      return;
    }

    let cleanPhone = paymentPhone.replace(/[^\d]/g, '');
    if (cleanPhone.startsWith('245') && cleanPhone.length === 12) {
      cleanPhone = cleanPhone.substring(3);
    }
    
    const isGwPhoneValid = /^9[567]\d{7}$/.test(cleanPhone);
    
    if (!cleanPhone || !isGwPhoneValid) {
      Alert.alert(
        t('error_title', 'Erro de Formato'), 
        t('invalid_phone_msg', 'Por favor, informe um número válido de 9 dígitos da conta Orange Money ou MTN (ex: 95XXXXXXX, 96XXXXXXX ou 97XXXXXXX).')
      );
      return;
    }

    setIsProcessingPayment(true);

    try {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 30000);

      const paymentResponse = await initiateMobileMoneyPayment({
        phone: cleanPhone,
        amount: estimatedPrice || 1000,
        provider: paymentMethod as 'ORANGE_MONEY' | 'MTN_MOMO',
        passengerId: user.id,
      }, { signal: abortController.signal });

      clearTimeout(timeoutId);

      if (paymentResponse?.success) {
        if (isMountedRef.current) {
          setIsProcessingPayment(false);
          setIsPaymentModalVisible(false);
        }

        Alert.alert(
          'Solicitação Enviada 📲',
          'Confirme a transação inserindo o seu PIN no prompt USSD que apareceu na tela do seu celular.',
          [
            { text: 'OK, já confirmei', onPress: () => executeRideRequest() }
          ]
        );
      } else {
        throw new Error(paymentResponse?.message || 'Falha ao processar pagamento.');
      }
    } catch (error: unknown) {
      if (isMountedRef.current) {
        setIsProcessingPayment(false);
      }
      const err = error as { name?: string; response?: { data?: { message?: string } } };
      const isTimeout = err.name === 'AbortError';
      Alert.alert(
        t('error_title', 'Aviso no Pagamento'), 
        isTimeout 
          ? 'A operadora está demorando para responder. Tente novamente ou use dinheiro.' 
          : err?.response?.data?.message || 'Não foi possível autorizar o débito. Verifique o saldo ou o número e tente novamente.'
      );
    }
  }

  function executeRideRequest() {
    if (!user?.id || !pickupCoords) {
      Alert.alert(t('warning_title', 'Aviso ⚠️'), t('missing_data_msg', 'Dados insuficientes para iniciar a corrida. Verifique sua localização.'));
      return;
    }

    try {
      if (!socket.connected) connectPassengerSocket();

      setRideStatus('searching');
      
      const mappedServiceType = serviceType === 'viagem' ? 'RIDE' : serviceType === 'entrega' ? 'DELIVERY' : 'RENTAL';
      const mappedVehicleType = vehicleType === 'particular' ? 'PARTICULAR' : vehicleType === 'moto-carro' ? 'MOTO_CARRO' : vehicleType.toUpperCase();
      const regionLabel = RENTAL_PRICES[selectedRegion]?.label || selectedRegion;

      emitRequestRide({
        passengerId: user.id,
        passengerName: (user as any)?.name || user.fullName,
        passengerRating: Number((user as any)?.rating || user.ratingAverage || 5.0),
        pickupLat: pickupCoords.latitude,
        pickupLng: pickupCoords.longitude,
        originAddress: pickupAddress,
        destinationLat: dropoffCoords?.latitude || pickupCoords.latitude,
        destinationLng: dropoffCoords?.longitude || pickupCoords.longitude,
        destinationAddress: serviceType === 'aluguel' ? `Aluguel Toca-Toca (${regionLabel})` : dropoffAddress,
        referencePoint: referencePoint.trim(),
        serviceType: mappedServiceType,
        vehicleType: mappedVehicleType,
        paymentMethod: paymentMethod,
        estimatedPrice: estimatedPrice,
        priceXof: estimatedPrice,
        guestName: isForAnotherPerson ? guestName : undefined,
        guestPhone: isForAnotherPerson ? guestPhone : undefined,
        stops: (extraStopCoords?.latitude && extraStopCoords?.longitude) ? [
          {
            address: extraStopAddress || '',
            lat: extraStopCoords.latitude,
            lng: extraStopCoords.longitude,
            status: 'PENDING'
          }
        ] : [],
        extraStopLat: extraStopCoords?.latitude,
        extraStopLng: extraStopCoords?.longitude,
        extraStopAddress: extraStopAddress || undefined,
      });

      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          Alert.alert(
            t('no_response_title', 'Sem resposta'), 
            t('no_driver_accepted_msg', 'Nenhum motorista aceitou no momento. Tente novamente.')
          );
          resetRideState();
        }
      }, 60000);

    } catch (error) {
      Alert.alert(
        t('error_title', 'Erro'), 
        t('server_error_msg', 'Ocorreu um problema ao comunicar com os servidores.')
      );
    }
  }

  function checkPenaltyApplicable() {
    if (!acceptedAt) return false;
    return (new Date().getTime() - acceptedAt.getTime()) > 2 * 60 * 1000;
  }

  const handleCloseCancelModal = useCallback(() => setShowCancelModal(false), []);

  const handleConfirmCancel = useCallback((reason: string) => {
    if (!activeRideId || !user?.id) {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      resetRideState();
      return;
    }
    
    cancelRideByPassenger(activeRideId, user.id, reason);
    setShowCancelModal(false);
    
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    persistRideState(null, 'idle');
    setActiveRideId(null);
    setRideStatus('idle');
    setDriverInfo(null);
    setDriverLocation(null);
    setStartOtp('');
    
    if (activeRideIdRef.current) activeRideIdRef.current = null;
    resetRideState();
  }, [activeRideId, user?.id, resetRideState]);

  const onMapRegionDidChange = useCallback(async (feature: any) => {
  setIsMapMoving(false);
  if (rideStatus !== 'idle' || bookingStep !== 'ADDRESS') return;

  // Se o endereço foi digitado/selecionado manualmente via busca e o usuário NÃO arrastou o mapa com o dedo,
  // mantém o endereço digitado sem sobrescrever com o endereço da geocodificação do GPS.
  if (isManualPickupRef.current) return;

  const coords = feature?.geometry?.coordinates;
  if (!coords || !Array.isArray(coords) || coords.length < 2) return;

  const [lng, lat] = coords;
  if (typeof lng !== 'number' || typeof lat !== 'number' || isNaN(lng) || isNaN(lat)) return;

  setPickupCoords({ latitude: lat, longitude: lng });

  const localName = findNearestLocalBairro(lat, lng);
  if (localName) {
    setPickupAddress(localName);
    return;
  }

  if (MAPBOX_ACCESS_TOKEN) {
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?language=pt&access_token=${MAPBOX_ACCESS_TOKEN}`;
      const res = await fetch(url);

      if (!res.ok) return;

      const data = await res.json();
      
      if (data?.features?.length > 0) {
        const placeName = data.features[0].place_name || '';
        const parts = placeName.split(',')
          .map((p: string) => p.trim())
          .filter((p: string) => p && !p.toLowerCase().includes('guiné'));
        const cleanAddress = parts.length > 0 ? parts.slice(0, 2).join(', ') : 'Bissau, Centro';
        setPickupAddress(cleanAddress);
      }
    } catch (err) {
      console.warn('Geocodificação Mapbox falhou no arraste:', err);
      setPickupAddress('Bissau, Centro');
    }
  }
}, [rideStatus, bookingStep]);
  const handleSubmitRating = useCallback((stars: number, tags: string[], comment: string) => {
    if (activeRideId && driverInfo && user?.id) {
      rateDriver({ 
        rideId: activeRideId, 
        reviewerId: user.id, 
        reviewerType: 'PASSENGER', 
        receiverId: driverInfo.id, 
        stars, 
        tags,
        comment 
      });
    }
    setShowRatingModal(false);
    resetRideState();
  }, [activeRideId, driverInfo, user?.id, resetRideState]);
  
  const handleCallDriver = () => {
    setIsChatVisible(true);
    Alert.alert(
      t('contact_protected_title', 'Contato Protegido 🔒'),
      t('contact_protected_msg', 'Por motivos de segurança e privacidade, a comunicação deve ser feita exclusivamente pelo Chat do aplicativo.')
    );
  };

  const handleShareTrip = async () => {
    try {
      if (!driverInfo || !dropoffAddress || !activeRideId) {
        Alert.alert(t('warning_title', 'Aviso ⚠️'), t('wait_trip_data', 'Aguarde os dados da corrida carregarem para compartilhar.'));
        return;
      }

      const trackingUrl = `https://nobai245.com/track/${activeRideId}`;

      const mensagem = `🚕 Acompanhe minha viagem no Nobai245!\n\n` +
        `👤 Motorista: ${driverInfo.name}\n` +
        `🚘 Veículo: ${driverInfo.carModel || 'Veículo'} (${driverInfo.carColor || 'Cor N/A'}) - Placa: ${driverInfo.licensePlate || 'N/A'}\n` +
        `📍 Destino: ${dropoffAddress}\n` +
        `${driverEta ? `⏳ Previsão de chegada: ${driverEta} minutos\n` : ''}` +
        `🌐 Acompanhe em tempo real pelo navegador: ${trackingUrl}`;

      await Share.share({ message: mensagem, title: 'Detalhes da minha corrida' });
    } catch (error) {
      Alert.alert(t('error_title', 'Erro'), t('share_error_msg', 'Não foi possível abrir o menu de compartilhamento.'));
    }
  };

  function sendMessage() {
    if (!inputText.trim() || !activeRideId) return;
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const passengerName = (user as any)?.name || user?.fullName || t('passenger', 'Passageiro');

    setMessages(prev => [...prev, { id: uniqueId, sender: 'passenger', text: inputText.trim() }]);
    sendChatMessage(activeRideId, passengerName, inputText.trim());
    setInputText('');
  }

  function openSearchModal(type: 'pickup' | 'dropoff' | 'extraStop') {
    setSearchType(type);
    setSearchQuery('');
    setSearchResults([]);
    setIsSearchModalVisible(true);
  }
const handleSosPress = () => {
  Alert.alert(
    t('emergency_sos', 'SOS / Emergência 🚨'),
    t('choose_emergency_service', 'Selecione o serviço de emergência que deseja contactar:'),
    [
      { 
        text: '🚨 Central de Segurança (112)', 
        onPress: () => Linking.openURL('tel:112').catch(() => {}) 
      },
      { 
        text: '🚒 Bombeiros (1313)', 
        onPress: () => Linking.openURL('tel:1313').catch(() => {}) 
      },
      { 
        text: '🚑 Saúde / Ambulância (1919)', 
        onPress: () => Linking.openURL('tel:1919').catch(() => {}) 
      },
      { 
        text: t('back_btn', 'Cancelar'), 
        style: 'cancel' 
      },
    ],
    { cancelable: true }
  );
};
  if (!passengerLocation) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFF" />
        <MaterialCommunityIcons name="map-marker-radius" size={54} color="#EAB308" />
        <Text style={styles.loadingText}>{locationError || t('getting_location', 'Obtendo localização exata...')}</Text>
        {locationError && (
          <TouchableOpacity 
            style={styles.retryLocationBtn} 
            onPress={getCurrentLocationWithFallback}
          >
            <Text style={{ color: '#0F172A', fontWeight: 'bold' }}>{t('try_again', 'Tentar Novamente')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const activeOtpPin = String(startOtp || driverInfo?.startOtp || '');
  return (
    <View style={styles.container}>
      <View style={styles.floatingHeader}>
        <View style={styles.headerContent}>
          <TouchableOpacity 
            style={styles.headerUserInfo} 
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Profile')}
          >
            <View style={styles.avatarPlaceholder}>
              {user?.profilePicture ? (
                <Image 
                  source={{ uri: formatPhotoUrl(user.profilePicture) }} 
                  style={{ width: '100%', height: '100%', borderRadius: 50 }} 
                />
              ) : (
                <Ionicons name="person" size={16} color="#0F172A" />
              )}
            </View>
            <Text style={styles.greetingText}>
              {t('greeting', 'Olá')}, {user?.fullName ? user.fullName.split(' ')[0] : t('passenger', 'Passageiro')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.langHeaderBtn} 
            onPress={() => setLangModalVisible(true)}
          >
            <Text style={styles.langHeaderBtnText}>{i18n.language?.toUpperCase() || 'PT'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuIcon} activeOpacity={0.7} onPress={() => setIsMenuVisible(true)}>
            <Ionicons name="menu" size={22} color="#0F172A" />
          </TouchableOpacity>
        </View>
      </View>

      <Mapbox.MapView
  style={StyleSheet.absoluteFill}
  styleURL={Mapbox.StyleURL.Street}
  logoEnabled={false}
  attributionEnabled={false}
  onCameraChanged={(e) => {
    // Só desativa a trava manual se for um gesto ativo do usuário (arrastou a tela com o dedo)
    if (e.gestures.isGestureActive) {
      setIsMapMoving(true);
      isManualPickupRef.current = false;
    }
  }}
  onMapIdle={onMapRegionDidChange}
>
        <Mapbox.Camera
          ref={cameraRef}
          zoomLevel={14}
          centerCoordinate={[
            passengerLocation?.coords?.longitude || BISSAU_CENTER.longitude,
            passengerLocation?.coords?.latitude || BISSAU_CENTER.latitude,
          ]}
          animationMode="flyTo"
          animationDuration={1000}
        />

        {/* ROTA MAPBOX */}
        {routeGeometry?.type === 'Feature' && routeGeometry?.geometry?.coordinates && (
          <Mapbox.ShapeSource id="routeSource" shape={routeGeometry}>
            <Mapbox.LineLayer
              id="routeLine"
              style={{
                lineColor: '#0F172A',
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* PONTO DE EMBARQUE */}
        {pickupCoords?.latitude != null && pickupCoords?.longitude != null && rideStatus !== 'idle' && (
          <Mapbox.PointAnnotation
            id="pickupMarker"
            coordinate={[Number(pickupCoords.longitude), Number(pickupCoords.latitude)]}
          >
            <View style={styles.carMarker}>
              <Ionicons name="location" size={18} color="#0F172A" />
            </View>
          </Mapbox.PointAnnotation>
        )}

        {/* PARADA EXTRA */}
        {extraStopCoords?.latitude != null && extraStopCoords?.longitude != null && (
          <Mapbox.PointAnnotation
            id="extraStopMarker"
            coordinate={[Number(extraStopCoords.longitude), Number(extraStopCoords.latitude)]}
          >
            <View style={[styles.carMarker, { backgroundColor: '#3B82F6', borderColor: '#FFF' }]}>
              <Ionicons name="location" size={16} color="#FFF" />
            </View>
          </Mapbox.PointAnnotation>
        )}

        {/* DESTINO FINAL */}
        {dropoffCoords?.latitude != null && dropoffCoords?.longitude != null && (
          <Mapbox.PointAnnotation
            id="dropoffMarker"
            coordinate={[Number(dropoffCoords.longitude), Number(dropoffCoords.latitude)]}
          >
            <View style={[styles.carMarker, { backgroundColor: '#0F172A' }]}>
              <Ionicons name="flag" size={16} color="#FFF" />
            </View>
          </Mapbox.PointAnnotation>
        )}

        {/* MOTORISTA */}
        {driverLocation?.latitude != null && driverLocation?.longitude != null && (
          <Mapbox.PointAnnotation
            id="driverMarker"
            coordinate={[Number(driverLocation.longitude), Number(driverLocation.latitude)]}
          >
            <View 
              style={[
                styles.driverMarkerContainer, 
                { 
                  backgroundColor: getVehicleColorHex(driverInfo?.carColor),
                  borderWidth: 2,
                  borderColor: driverInfo?.carColor?.toLowerCase().includes('branc') ? '#94A3B8' : '#FFFFFF'
                }
              ]}
            >
              <MaterialCommunityIcons 
                name={getVehicleIcon(driverInfo?.vehicleType || vehicleType) as any} 
                size={20} 
                color={driverInfo?.carColor?.toLowerCase().includes('branc') ? '#0F172A' : '#FFFFFF'} 
              />
            </View>
          </Mapbox.PointAnnotation>
        )}
      </Mapbox.MapView>

      {/* PINO CENTRAL FLUTUANTE */}
      {rideStatus === 'idle' && bookingStep === 'ADDRESS' && (
        <View style={styles.centerPinContainer} pointerEvents="none">
          <Animated.View style={[styles.centerPin, isMapMoving && { transform: [{ translateY: -10 }] }]}>
            <Ionicons name="location" size={36} color="#0F172A" />
          </Animated.View>
          <View style={styles.pinShadow} />
        </View>
      )}

      <TouchableOpacity 
        style={styles.recenterButton} 
        activeOpacity={0.85}
        onPress={() => {
          if (passengerLocation?.coords && cameraRef.current) {
            cameraRef.current.setCamera({
              centerCoordinate: [passengerLocation.coords.longitude, passengerLocation.coords.latitude],
              zoomLevel: 15,
              animationDuration: 800,
            });
          }
        }}
      >
        <Ionicons name="locate" size={20} color="#0F172A" />
      </TouchableOpacity>

      {rideStatus === 'idle' && bookingStep === 'ADDRESS' && (
        <View style={styles.favoritesContainer}>
          <TouchableOpacity style={styles.favoriteButton} activeOpacity={0.8} onPress={() => handleFavoritePress('home')}>
            <View style={styles.favoriteIconBg}>
              <Ionicons name="home" size={14} color="#0F172A" />
            </View>
            <Text style={styles.favoriteText} numberOfLines={1}>
              {homeLocation ? homeLocation.address : t('save_home', 'Salvar Casa')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.favoriteButton} activeOpacity={0.8} onPress={() => handleFavoritePress('work')}>
            <View style={styles.favoriteIconBg}>
              <Ionicons name="briefcase" size={14} color="#0F172A" />
            </View>
            <Text style={styles.favoriteText} numberOfLines={1}>
              {workLocation ? workLocation.address : t('save_work', 'Salvar Trabalho')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {isNightTimeForPin() && Boolean(activeOtpPin) && ['accepted', 'arrived'].includes(rideStatus) && (
        <View style={styles.pinSecurityBadge}>
          <Ionicons name="shield-checkmark" size={20} color="#B45309" />
          <View style={styles.pinSecurityTextContainer}>
            <Text style={styles.pinSecurityTitle}>{t('boarding_pin_title', 'PIN DE EMBARQUE')}</Text>
            <Text style={styles.pinSecuritySub}>{t('tell_pin_to_driver_msg', 'Fale este código ao motorista para iniciar a corrida')}</Text>
          </View>
          <View style={styles.pinCodeBox}>
            <Text style={styles.pinCodeText}>{activeOtpPin}</Text>
          </View>
        </View>
      )}

      {/* KEYBOARD AVOIDING VIEW - PAINEL PRINCIPAL */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.bottomSheetWrapper} pointerEvents="box-none">
        <Animated.View style={[styles.bottomSheet, { transform: [{ translateY }] }]}>
          
          <View style={styles.dragHandlerArea} {...panResponder.panHandlers}>
            <View style={styles.dragIndicator} />
          </View>

          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingBottom: 20 }}>
            
            {rideStatus === 'idle' && bookingStep === 'ADDRESS' && (
              <View style={{ width: '100%', paddingTop: 4 }}>
                <Text style={styles.sheetTitle}>{t('where_to', 'Para onde vamos?')}</Text>
                
                <TouchableOpacity style={styles.mainSearchInput} activeOpacity={0.8} onPress={() => openSearchModal('dropoff')}>
                  <Ionicons name="search" size={20} color="#EAB308" style={{ marginRight: 12 }} />
                  <Text style={styles.mainSearchText} numberOfLines={1} ellipsizeMode="tail">
                    {dropoffAddress || t('enter_destination_placeholder', 'Digite seu destino...')}
                  </Text>
                </TouchableOpacity>

                {dropoffCoords ? (
                  <TouchableOpacity style={styles.requestButton} activeOpacity={0.85} onPress={() => setBookingStep('SERVICE_AND_PRICE')}>
                    <Text style={styles.requestButtonText}>{t('next_btn', 'Avançar')}</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[styles.requestButton, { backgroundColor: '#F1F5F9' }]} activeOpacity={0.8} onPress={() => openSearchModal('dropoff')}>
                    <Text style={[styles.requestButtonText, { color: '#64748B' }]}>{t('where_do_you_want_to_go', 'Aonde você quer ir?')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {rideStatus === 'idle' && bookingStep === 'SERVICE_AND_PRICE' && (
              <View style={{ width: '100%' }}>
                <Text style={styles.sectionLabel}>{t('service_type', 'Tipo de Serviço')}</Text>
                <View style={styles.serviceTypesContainer}>
                  <TouchableOpacity 
                    style={[styles.serviceTypeButton, serviceType === 'viagem' && styles.serviceTypeActive]}
                    onPress={() => setServiceType('viagem')}
                  >
                    <Ionicons name="car-outline" size={18} color={serviceType === 'viagem' ? '#0F172A' : '#64748B'} />
                    <Text style={[styles.serviceTypeText, serviceType === 'viagem' && styles.serviceTypeTextActive]}>{t('ride_service', 'Viagem')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.serviceTypeButton, serviceType === 'entrega' && styles.serviceTypeActive]}
                    onPress={() => setServiceType('entrega')}
                  >
                    <Ionicons name="cube-outline" size={18} color={serviceType === 'entrega' ? '#0F172A' : '#64748B'} />
                    <Text style={[styles.serviceTypeText, serviceType === 'entrega' && styles.serviceTypeTextActive]}>{t('delivery_service', 'Entrega')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.serviceTypeButton, serviceType === 'aluguel' && styles.serviceTypeActive]}
                    onPress={() => setServiceType('aluguel')}
                  >
                    <Ionicons name="key-outline" size={18} color={serviceType === 'aluguel' ? '#0F172A' : '#64748B'} />
                    <Text style={[styles.serviceTypeText, serviceType === 'aluguel' && styles.serviceTypeTextActive]}>{t('rental_service', 'Aluguel')}</Text>
                  </TouchableOpacity>
                </View>

                {serviceType === 'aluguel' ? (
                  <View style={{ marginTop: 12 }}>
                    <Text style={styles.sectionLabel}>{t('select_coverage_region', 'Selecione a Região de Cobertura')}</Text>
                    <TouchableOpacity style={[styles.categoryCard, styles.categoryCardActive, { borderColor: '#EAB308', borderWidth: 2 }]} activeOpacity={0.9}>
                      <View style={{ backgroundColor: '#FEF08A', padding: 8, borderRadius: 8, marginRight: 12 }}>
                        <Ionicons name="map-outline" size={24} color="#0F172A" />
                      </View>
                      <View style={styles.categoryTextWrapper}>
                        <Text style={[styles.categoryTitle, styles.categoryTextActive]}>{RENTAL_PRICES[selectedRegion]?.label || 'Bissau'}</Text>
                        <Text style={styles.categorySubtitle}>{RENTAL_PRICES[selectedRegion]?.description}</Text>
                      </View>
                      <Text style={[styles.categoryPriceText, styles.categoryPriceTextActive, { color: '#15803D' }]}>
                        {RENTAL_PRICES[selectedRegion]?.price ? `${RENTAL_PRICES[selectedRegion].price?.toLocaleString('pt-BR')} XOF` : t('on_request', 'Sob Consulta')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View>
                    <Text style={styles.sectionLabel}>{t('vehicle_options', 'Opções de Veículo')}</Text>
                    <View style={styles.vehicleCategoryContainer}>
                      {VEHICLE_OPTIONS.map((item) => {
                        const isSelected = vehicleType === item.id;
                        const price = calculateVehiclePrice(item.id, estimatedDistance);
                        return (
                          <TouchableOpacity 
                            key={item.id} 
                            style={[styles.categoryCard, isSelected && styles.categoryCardActive]}
                            activeOpacity={0.8}
                            onPress={() => setVehicleType(item.id)}
                          >
                            <Image source={item.image} style={styles.vehicleImage} resizeMode="contain" />
                            <View style={styles.categoryTextWrapper}>
                              <Text style={[styles.categoryTitle, isSelected && styles.categoryTextActive]}>{item.title}</Text>
                              <Text style={styles.categorySubtitle}>{item.subtitle}</Text>
                            </View>
                            <Text style={[styles.categoryPriceText, isSelected && styles.categoryPriceTextActive]}>
                              {price ? `${price} XOF` : t('calculating', 'Calculando...')}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}
